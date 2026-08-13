import type { Terminal } from '@xterm/xterm'

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
        if (!text) return
        onBeforePaste?.()
        term.paste(text)
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
