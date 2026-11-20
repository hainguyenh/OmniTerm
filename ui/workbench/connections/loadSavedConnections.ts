import type { Connection } from '../../domain'

/** Every workspace's saved connections, each tagged with the workspace it belongs to. */
export async function loadSavedConnections(): Promise<Connection[]> {
  const api = window.omnitermAPI.workspace
  const workspaces = await api.list()
  const lists = await Promise.all(
    workspaces.map((workspace) =>
      api.loadConnections(workspace.id).then((connections) =>
        connections.map((connection) => ({ ...connection, workspaceId: workspace.id })),
      ),
    ),
  )
  return lists.flat()
}
