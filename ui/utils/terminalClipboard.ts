import type { Terminal } from '@xterm/xterm'
import type { SavedPastedImage } from './pastedImageStore'

/**
 * Native `paste` event gate for one pane.
 *
 * Runs capture-phase before xterm's own listener and owns every native paste
 * so exactly one writer reaches the PTY (see utils/paste.ts). Text is inserted
 * directly, including Windows clipboard-history selections that have no Ctrl+V
 * keydown. Images are persisted to temp PNGs and inserted by absolute path.
 *
 * `canInsertImagePaths` false opts the pane out of that contract: the event is
 * left untouched so the WebView's default paste runs (text pastes normally, an
 * image-only clipboard does nothing) — for agents that read the clipboard
 * themselves and would only choke on a visible file path.
 */
export const createNativePasteGate = ({
  term,
  noteLocalEcho,
  isSuppressed,
  canInsertImagePaths = () => true,
  onImageSaved,
}: {
  term: Terminal
  noteLocalEcho: () => void
  /** True while an app-claimed paste just wrote, so Chromium's echo must drop. */
  isSuppressed: () => boolean
  canInsertImagePaths?: () => boolean
  /** Receives the bytes + temp path of every persisted image, for the pane's pasted-image viewer. */
  onImageSaved?: (saved: SavedPastedImage) => void
}): ((event: ClipboardEvent) => void) => {
  return (event: ClipboardEvent) => {
    const cancelNativePaste = () => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    if (isSuppressed()) {
      cancelNativePaste()
      return
    }
    const imageItem = Array.from(event.clipboardData?.items ?? []).find(item =>
      item.type.startsWith('image/'),
    )
    if (imageItem && !canInsertImagePaths()) return
    if (imageItem) {
      cancelNativePaste()
      void imageItem.getAsFile()?.arrayBuffer().then(async bytes => {
        const path = await window.omnitermAPI.clipboard.saveImageTemp(new Uint8Array(bytes))
        if (path) {
          onImageSaved?.({ bytes: new Uint8Array(bytes), path })
          noteLocalEcho()
          term.paste(path)
        }
      })
      return
    }
    const text = event.clipboardData?.getData('text/plain') ?? ''
    cancelNativePaste()
    if (text) {
      noteLocalEcho()
      term.paste(text)
    }
  }
}

/**
 * Encode raw RGBA pixels (the native clipboard plugin's format) as PNG bytes through a canvas,
 * so they can ride the existing `saveImageTemp` temp-file contract. Null when the payload is
 * malformed or the environment cannot encode.
 */
const pngBytesFromRgba = async (
  image: { rgba: Uint8Array; width: number; height: number },
): Promise<Uint8Array | null> => {
  const { rgba, width, height } = image
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    // createImageData (not `new ImageData`) keeps this usable in environments without the
    // constructor and lets tests stub the 2D context wholesale.
    const target = context.createImageData(width, height)
    target.data.set(rgba.subarray(0, Math.min(rgba.length, target.data.length)))
    context.putImageData(target, 0, 0)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return null
    return new Uint8Array(await blob.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Read the clipboard as an image, persist it to a temp PNG via the native
 * side, and resolve to the saved image (bytes + absolute path) — or null when
 * the clipboard holds no image / the read is denied. Two readers, in order:
 * the Web Clipboard API (works where the WebView grants it) and then the
 * native plugin — WebView2 denies `navigator.clipboard.read()` by default, so
 * without the fallback Ctrl+V with an image on the clipboard did nothing at
 * all. Both paths converge on the same temp-PNG file the agent attaches by
 * path.
 */
const readImageFromClipboard = async (): Promise<SavedPastedImage | null> => {
  try {
    const read = navigator.clipboard?.read?.bind(navigator.clipboard)
    if (read) {
      const items = await read()
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/'))
        if (!type) continue
        const blob = await item.getType(type)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const path = await window.omnitermAPI.clipboard.saveImageTemp(bytes)
        if (path) return { bytes, path }
      }
    }
  } catch {
    // Permission denied or no image: fall through to the native reader.
  }
  const image = await window.omnitermAPI.clipboard.readImage()
  if (!image) return null
  const bytes = await pngBytesFromRgba(image)
  if (!bytes) return null
  const path = await window.omnitermAPI.clipboard.saveImageTemp(bytes)
  return path ? { bytes, path } : null
}

/**
 * Clipboard wiring for one terminal pane: selecting text auto-copies it, right-click pastes.
 *
 * The keyboard half (Ctrl+V, Ctrl+Shift+V, Ctrl+Shift+C — never plain Ctrl+C, which must stay
 * SIGINT) lives in utils/paste.ts, which decides *whether* a keydown is a clipboard action; this
 * module is what actually performs one. They are split because the routing decision has to be
 * unit-testable without a real WebView — see paste.ts for why.
 */

export interface TerminalClipboard {
  paste: () => Promise<void>
  copySelection: () => Promise<void>
  /** Detach the selection listener. */
  dispose: () => void
}

/**
 * One clipboard write shared by selection auto-copy and the pane-header copy menu: the native
 * plugin first (works under Tauri without focus quirks), the Web Clipboard API as fallback.
 */
export const writeClipboardText = async (text: string): Promise<void> => {
  try {
    await window.omnitermAPI.clipboard.writeText(text)
  } catch {
    await navigator.clipboard?.writeText(text)
  }
}

/**
 * @param onBeforePaste Called immediately before the payload reaches the terminal. Used to quiet the
 *                      highlighter, which must not rewrite the echo that follows — see
 *                      `OutputHighlighter.noteLocalEcho`.
 */
export const createTerminalClipboard = (
  term: Terminal,
  onBeforePaste?: () => void,
  /** False makes an image-only clipboard paste inert instead of inserting a temp-file path. */
  canInsertImagePaths: () => boolean = () => true,
  /** Receives every persisted image for the pane's pasted-image viewer; omit for the old behavior. */
  onImageSaved?: (saved: SavedPastedImage) => void,
): TerminalClipboard => {
  let pasteInFlight = false
  let copyTimer = 0

  const copySelection = async () => {
    const sel = term.getSelection()
    if (!sel) return
    await writeClipboardText(sel)
  }

  // Debounced auto-copy: a drag fires onSelectionChange on every cell boundary, so dozens of
  // concurrent async clipboard writes race and the final text can lose to an earlier partial.
  // Capture the selection text synchronously (before streaming output can invalidate it), then
  // coalesce into a single write after the drag settles.
  const selectionDisposable = term.onSelectionChange(() => {
    const sel = term.getSelection()
    if (!sel) return
    // Snapshot the text now; the deferred write will use whatever was last captured.
    const captured = sel
    window.clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => {
      void writeClipboardText(captured)
    }, 80) as unknown as number
  })

  return {
    // Routed through `term.paste` (CRLF→CR + DECSET-2004 bracketing), not the session's raw input
    // channel, so this path and xterm's own native paste listener (right-click, macOS Cmd+V) write
    // byte-identical output — sending raw text here is what made one paste route run the pasted
    // lines as commands.
    paste: async () => {
      if (pasteInFlight) return
      pasteInFlight = true
      try {
        // A rejected read means the clipboard holds no text (image-only, or a blocked read) —
        // it must fall through to the image path below instead of failing the whole paste.
        let text = ''
        try {
          text = await window.omnitermAPI.clipboard.readText()
        } catch {
          text = ''
        }
        if (text) {
          onBeforePaste?.()
          term.paste(text)
          return
        }
        // Text clipboard empty: an image may be on it. When path insertion is enabled, the
        // image is persisted and its absolute path inserted — the contract Claude Code /
        // OpenCode / Gemini CLI accept. With the setting off the paste stays inert so agents
        // that read the clipboard themselves never see a stray path.
        if (!canInsertImagePaths()) return
        const saved = await readImageFromClipboard()
        if (saved) {
          onImageSaved?.(saved)
          onBeforePaste?.()
          term.paste(saved.path)
        }
      } finally {
        pasteInFlight = false
      }
    },
    copySelection,
    dispose: () => {
      window.clearTimeout(copyTimer)
      selectionDisposable.dispose()
    },
  }
}
