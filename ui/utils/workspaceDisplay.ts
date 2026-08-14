import type { Workspace } from '@omniterm/contract'

export function workspaceLocationLabel(workspace: Workspace | undefined): string {
  if (!workspace) return 'No workspace selected'
  const folderNames = workspace.folders
    .map(folder => folder.name.trim())
    .filter(Boolean)
  return folderNames.length > 0
    ? `${workspace.name} - ${folderNames.join(', ')}`
    : workspace.name
}
