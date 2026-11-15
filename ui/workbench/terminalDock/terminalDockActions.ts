import { useProject } from '../../ide/platform/project'
import { toolWindowService } from '../../ide/workbench/contributions'
import type { ShellOption } from '../../shellOptions'

import { dockSession, expectDockedSession } from './terminalDockStore'

/** Id of OmniTerm's bottom Terminal tool window. */
export const TERMINAL_WINDOW = 'omniterm.terminal'

/**
 * Starts a local shell in the project folder that opens in the Terminal tool window: `shell` (an id
 * of `loadShellOptions`, as IDEA's "New Terminal ⌄" offers), else the user's default. The session is
 * docked when it shows up on the session bridge. Anything but a string (a click event, an action
 * argument) picks the default.
 */
export function requestDockedTerminal(shell?: unknown): void {
  expectDockedSession()
  const cwd = useProject.getState().project?.root ?? undefined
  const chosen = typeof shell === 'string' && shell ? shell : undefined
  const detail = cwd || chosen ? { ...(cwd ? { cwd } : {}), ...(chosen ? { shell: chosen } : {}) } : null
  window.dispatchEvent(new CustomEvent('omniterm:new-session', { detail }))
  toolWindowService().show(TERMINAL_WINDOW)
}

/** Moves a session from its editor tab into the Terminal tool window (its tab closes, it keeps running). */
export function moveSessionToTerminalWindow(sessionId: string): void {
  dockSession(sessionId)
  toolWindowService().show(TERMINAL_WINDOW)
}

/** The menu items of "New Terminal ⌄": one per shell this machine can start, as IDEA lists them. */
export function shellMenuItems(options: readonly ShellOption[], open: (shell: string) => void = requestDockedTerminal) {
  return options.map((option) => ({ label: option.label, icon: 'terminal', verbatim: true, run: () => open(option.id) }))
}
