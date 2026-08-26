import type { Terminal } from '@xterm/xterm'

/**
 * Ctrl+wheel over a terminal changes only that pane's font size, never the app chrome's zoom —
 * the event must not reach the app-level Ctrl+wheel zoom handler (App.tsx), hence
 * preventDefault + stopPropagation. Extracted from TerminalView to keep the component within
 * the repository's 500-line cap.
 */
export const createCtrlWheelFontResizer = (
  term: Terminal,
  refit: () => void,
  onFontSizeChange: (size: number) => void,
): ((e: WheelEvent) => void) => {
  return (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    e.stopPropagation()
    const currentSize = term.options.fontSize ?? 14
    // Same 8–48 range as the app's font controls; the new size is reported up so the owner can
    // persist the override (the change stays visible in the footer/title bar, and survives remounts).
    const newSize = e.deltaY > 0 ? Math.max(8, currentSize - 1) : Math.min(48, currentSize + 1)
    if (newSize !== currentSize) {
      term.options.fontSize = newSize
      // safeFit, not a bare fitAddon.fit(): without the follow-up api.resize() the PTY kept the
      // pre-zoom cols/rows, and a full-screen TUI drew frames for a grid that no longer existed.
      refit()
      onFontSizeChange(newSize)
    }
  }
}
