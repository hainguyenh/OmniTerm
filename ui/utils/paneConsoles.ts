import type { Terminal } from '@xterm/xterm'

/**
 * The xterm of each pane in this window, for the agent footer's Clear button
 * (ui/workbench/sessions/SessionAgentHeader.tsx). Like paneScreens.ts, a pane in another window
 * (detached) is not registered here.
 */

type ConsoleSource = Pick<Terminal, 'clear'>

const consoles = new Map<string, ConsoleSource>()

export function registerPaneConsole(sessionId: string, term: ConsoleSource): { dispose: () => void } {
  consoles.set(sessionId, term)
  return {
    dispose: () => {
      // Identity check: a remounted pane registers a new terminal under the same session id.
      if (consoles.get(sessionId) === term) consoles.delete(sessionId)
    },
  }
}

/**
 * Clear the pane's scrollback and screen, keeping only the line the cursor is on. The agent and its
 * conversation are untouched: it draws again on its next output. False when the pane is not in this
 * window.
 */
export function clearPaneConsole(sessionId: string): boolean {
  const term = consoles.get(sessionId)
  if (!term) return false
  term.clear()
  return true
}
