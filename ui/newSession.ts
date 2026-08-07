/**
 * newSession.ts — opening a local pane that has no saved connection
 *
 * The "new session" button (and Ctrl+N, and the command palette) launches a shell the user never
 * saved, so there is no connection record for the backend to resolve. `shells.open` registers the
 * shell in Tauri's in-memory ad-hoc registry and returns
 *     the Connection record for it. Only the backend may decide what gets spawned, so an id it cannot
 *     resolve is refused — which is exactly what happened when the renderer invented
 *     `local-default-<timestamp>` and the pane hung on "connecting" with `Unknown connection`.
 */

/**
 * Resolve `shell` to a connection record and hand it to `onConnect`.
 *
 * Rejects if the backend refuses the shell (an unrecognized name, or one that cannot exist on this
 * platform); the caller decides how loudly to report that.
 *
 */
export async function openNewSession(
  shell: string,
  onConnect: (conn: any) => void,
): Promise<void> {
  const conn = await window.omnitermAPI.shells.open(shell)
  if (conn) onConnect(conn)
}
