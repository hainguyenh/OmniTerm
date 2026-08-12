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
  const copySelection = async () => {
    const sel = term.getSelection()
    if (!sel) return
    try {
      await window.omnitermAPI.clipboard.writeText(sel)
    } catch {
      await navigator.clipboard?.writeText(sel)
    }
  }

  const selectionDisposable = term.onSelectionChange(() => { void copySelection() })

  return {
    // Routed through `term.paste` (CRLF→CR + DECSET-2004 bracketing), not the session's raw input
    // channel, so this path and xterm's own native paste listener (right-click, macOS Cmd+V) write
    // byte-identical output — sending raw text here is what made one paste route run the pasted
    // lines as commands.
    paste: async () => {
      const text = await window.omnitermAPI.clipboard.readText()
      if (!text) return
      onBeforePaste?.()
      term.paste(text)
    },
    copySelection,
    dispose: () => selectionDisposable.dispose(),
  }
}
