import type { Terminal } from '@xterm/xterm'

/**
 * Native `paste` event gate for one pane.
 *
 * Runs capture-phase before xterm's own listener and swallows every native
 * paste so exactly one writer reaches the PTY (see utils/paste.ts). When the
 * event carries an image (macOS Cmd+V, right-click), the image is persisted to
 * a temp PNG and its absolute path inserted instead — agents attach by path.
 */
export const createNativePasteGate = ({
  term,
  noteLocalEcho,
  isSuppressed,
}: {
  term: Terminal
  noteLocalEcho: () => void
  /** True while an app-claimed paste just wrote, so Chromium's echo must drop. */
  isSuppressed: () => boolean
}): ((event: ClipboardEvent) => void) => {
  return (event: ClipboardEvent) => {
    if (isSuppressed()) return
    const imageItem = Array.from(event.clipboardData?.items ?? []).find(item =>
      item.type.startsWith('image/'),
    )
    if (imageItem) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      void imageItem.getAsFile()?.arrayBuffer().then(async bytes => {
        const path = await window.omnitermAPI.clipboard.saveImageTemp(new Uint8Array(bytes))
        if (path) {
          noteLocalEcho()
          term.paste(path)
        }
      })
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }
}

/**
 * Read the clipboard as an image, persist it to a temp PNG via the native
 * side, and resolve to that absolute path — or null when the clipboard holds
 * no image / the read is denied. Uses the Web Clipboard API so Ctrl+V,
 * Cmd+V and Alt+V all share one code path.
 */
const readImagePathFromClipboard = async (): Promise<string | null> => {
  try {
    const read = navigator.clipboard?.read?.bind(navigator.clipboard)
    if (!read) return null
    const items = await read()
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'))
      if (!type) continue
      const blob = await item.getType(type)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      return await window.omnitermAPI.clipboard.saveImageTemp(bytes)
    }
  } catch {
    // Permission denied or no image: fall through to null.
  }
  return null
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
 * @param onBeforePaste Called immediately before the payload reaches the terminal. Used to quiet the
 *                      output highlighter, which must not rewrite the echo that follows — see
 *                      `OutputHighlighter.noteLocalEcho`.
 */
export const createTerminalClipboard = (term: Terminal, onBeforePaste?: () => void): TerminalClipboard => {
  let pasteInFlight = false
  let copyTimer = 0

  const writeToClipboard = async (text: string) => {
    try {
      await window.omnitermAPI.clipboard.writeText(text)
    } catch {
      await navigator.clipboard?.writeText(text)
    }
  }

  const copySelection = async () => {
    const sel = term.getSelection()
    if (!sel) return
    await writeToClipboard(sel)
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
      void writeToClipboard(captured)
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
        const text = await window.omnitermAPI.clipboard.readText()
        if (text) {
          onBeforePaste?.()
          term.paste(text)
          return
        }
        // Text clipboard empty: an image may be on it. Agents cannot receive
        // pixels over a PTY, so we persist the image and insert its absolute
        // path — the contract Claude Code / OpenCode / Gemini CLI accept.
        const imagePath = await readImagePathFromClipboard()
        if (imagePath) {
          onBeforePaste?.()
          term.paste(imagePath)
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
