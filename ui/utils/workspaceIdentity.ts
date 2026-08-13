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
  return [...workspaces]
    .sort((a, b) => b.path.length - a.path.length)
    .find(workspace => {
      const root = workspace.path.replace(/[\\/]+$/, '').toLowerCase()
      return cwd === root || cwd.startsWith(`${root}\\`) || cwd.startsWith(`${root}/`)
    })
}
