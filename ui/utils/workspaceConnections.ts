import type { Connection } from '@omniterm/contract'

/**
 * Add or replace one connection in a workspace's `.omniterm/connections.json`.
 *
 * Read-modify-write rather than a targeted update, because the backend command takes the whole list —
 * so the merge has to happen somewhere, and doing it here keeps MainLayout out of it.
 *
 * Rejects if the write is refused (bad workspace path, over the 1 MB cap, unwritable folder). The
 * caller must surface that: the bridge used to swallow it, which told the user their connection was
 * saved when nothing had been written.
 */
export async function upsertWorkspaceConnection(
  workspaceId: string,
  conn: Connection,
  isEdit: boolean,
): Promise<void> {
  const existing = await window.omnitermAPI.workspace.loadConnections(workspaceId)
  const found = existing.some((c) => c.id === conn.id)
  const updated = isEdit && found
    ? existing.map((c) => (c.id === conn.id ? { ...c, ...conn } : c))
    : [...existing, conn]
  await window.omnitermAPI.workspace.saveConnections(workspaceId, updated)
}
