/**
 * Asks the session's terminal (TerminalView, which listens for this event) to take keyboard focus,
 * so typing goes straight to the program running there. A terminal that is not on screen ignores it.
 */
export function focusSessionTerminal(sessionId: string): void {
  window.dispatchEvent(new CustomEvent('omniterm:focus-terminal', { detail: { id: sessionId } }))
}
