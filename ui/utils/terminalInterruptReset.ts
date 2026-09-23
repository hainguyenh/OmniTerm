/**
 * Clears terminal modes a force-killed (or SIGINT-ignoring) foreground process left enabled.
 *
 * Stop (SessionControlButtons) force-kills the foreground process instead of waiting for a
 * graceful exit, so a TUI that enabled mouse tracking, bracketed paste, or a hidden cursor never
 * gets to send the matching DECRST before it dies. Left on, every later mouse move gets reported
 * as an escape sequence (e.g. SGR motion `\x1b[<...M`) that the shell then echoes back as literal
 * garbage text.
 */
interface InterruptResetTerminal {
  readonly buffer: { readonly active: { readonly type: 'normal' | 'alternate' } }
  write(data: string): void
}

export interface TerminalInterruptResetHandle {
  dispose(): void
}

/** Disabling an already-disabled mode is a no-op, so these are safe to send unconditionally. */
const MODE_RESET_SEQUENCE = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l\x1b[?1016l\x1b[?2004l\x1b[?25h'

export const installTerminalInterruptReset = (
  terminal: InterruptResetTerminal,
  id: string,
): TerminalInterruptResetHandle => {
  const onInterrupted = (event: Event): void => {
    if ((event as CustomEvent).detail?.id !== id) return
    // Exiting the alternate screen is the one mode with a cursor-restore side effect (see xterm's
    // DECRST 1049 handler), so it is only sent when actually active.
    const exitAltScreen = terminal.buffer.active.type === 'alternate' ? '\x1b[?1049l' : ''
    terminal.write(MODE_RESET_SEQUENCE + exitAltScreen)
  }
  window.addEventListener('omniterm:terminal-interrupted', onInterrupted)
  return { dispose: () => window.removeEventListener('omniterm:terminal-interrupted', onInterrupted) }
}
