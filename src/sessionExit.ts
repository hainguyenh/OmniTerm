/**
 * When a pane's shell exits, does its tab go with it?
 *
 * A pane launched to run something to completion (`localKeepOpen === false`, e.g. every workspace
 * script — see src-tauri/src/workspace_launch.rs) has nothing left to do once its shell is gone. Left
 * open it is worse than empty: xterm keeps drawing a blinking cursor, so the pane looks like a live
 * prompt, while every keystroke goes to a session the backend has already dropped. That is the "the
 * script said press a key to close, then the terminal hung and the tab stayed" report.
 *
 * A non-zero exit keeps the tab: the last thing on screen is why the script failed, and closing the
 * pane would take it away before it could be read. The user closes it (or reconnects) themselves.
 *
 * Panes the user opened to work in (`localKeepOpen` absent or true, and every SSH/RDP session) are
 * never closed for them — `exit` at a shell prompt should leave the final output on screen.
 */
export interface ExitPolicyConn {
  type?: string
  localKeepOpen?: boolean
}

export function closesOnExit(conn: ExitPolicyConn | null | undefined, exitCode: number): boolean {
  if (!conn || conn.type !== 'LOCAL') return false
  if (conn.localKeepOpen !== false) return false
  return exitCode === 0
}
