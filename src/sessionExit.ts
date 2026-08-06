/**
 * When a pane's shell exits, does its tab go with it?
 *
 * A pane launched to run something to completion (`localKeepOpen === false`, e.g. every workspace
 * script — see src-tauri/src/workspace_launch.rs) has nothing left to do once its shell is gone. Left
 * open it is worse than empty: xterm keeps drawing a blinking cursor, so the pane looks like a live
 * prompt, while every keystroke goes to a session the backend has already dropped. That is the "the
 * script said press a key to close, then the terminal hung and the tab stayed" report.
 *
 * A non-zero exit keeps command panes: the last thing on screen is why the script failed, and closing
 * the pane would take it away before it could be read. Interactive shells close on every exit code.
 *
 * Panes the user opened to work in close on exit when they have no command. `localKeepOpen` applies
 * only to command panes. SSH panes close on successful exit; RDP panes are never closed automatically.
 */
export interface ExitPolicyConn {
  type?: string
  localCommand?: string
  localKeepOpen?: boolean
}

export function closesOnExit(conn: ExitPolicyConn | null | undefined, exitCode: number): boolean {
  if (!conn) return false
  if (conn.type === 'RDP') return false
  // A plain interactive shell must close when the user types `exit`; keep-open only applies to
  // panes launched with a command that has finished.
  if (conn.type === 'LOCAL' && !conn.localCommand?.trim()) return true
  if (conn.localKeepOpen) return false
  return exitCode === 0
}
