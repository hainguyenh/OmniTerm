import { registerKeyClaim } from '../../ide/platform/keymap'
import { workflowSettings } from '../../ide/platform/workflowSettings'

/** An OmniTerm session's xterm, wherever its surface host is attached (editor tab or Terminal tool window). */
const SESSION_TERMINAL = '[data-session-host] .xterm'

/**
 * Escape typed in a session terminal belongs to the program running there (it interrupts Claude
 * Code, Codex and other agent CLIs). In the Terminal tool window the IDE keymap would otherwise run
 * "Focus Editor" (`toolwindow.focusEditor`, bound to Escape while a tool window has focus), so the
 * keystroke never reached the PTY. Editor-tab sessions never had the problem because that action
 * only applies inside tool windows. The project's "Move focus to the Editor with Escape" terminal
 * setting opts back into the IDE behaviour, as it does for the IDE's own terminal.
 */
export function claimsTerminalEscape(event: Pick<KeyboardEvent, 'target'>, stroke: string): boolean {
  if (stroke !== 'Escape') return false
  const target = event.target
  if (!(target instanceof Element) || !target.closest(SESSION_TERMINAL)) return false
  return !workflowSettings().terminal.escapeToEditor
}

/** Leaves Escape in session terminals to the terminal; returns the uninstaller. */
export function installTerminalEscapeClaim(): () => void {
  return registerKeyClaim(claimsTerminalEscape)
}
