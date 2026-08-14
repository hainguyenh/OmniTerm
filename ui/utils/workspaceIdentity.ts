import type { Connection, Workspace } from '@omniterm/contract'

export function workspaceForConnection(
  workspaces: Workspace[],
  connection?: Connection,
): Workspace | undefined {
  if (!connection) return undefined
  if (connection.workspaceId) {
    return workspaces.find(workspace => workspace.id === connection.workspaceId)
  }
  if (connection.type !== 'LOCAL' || !connection.localCwd) return undefined
  const cwd = connection.localCwd.replace(/[\\/]+$/, '').toLowerCase()
  let bestMatch: { workspace: Workspace; rootLength: number } | undefined
  for (const workspace of workspaces) {
    for (const folder of workspace.folders) {
      const root = folder.path.replace(/[\\/]+$/, '').toLowerCase()
      if (cwd !== root && !cwd.startsWith(`${root}\\`) && !cwd.startsWith(`${root}/`)) continue
      if (!bestMatch || root.length > bestMatch.rootLength) {
        bestMatch = { workspace, rootLength: root.length }
      }
    }
  }
  return bestMatch?.workspace
}
