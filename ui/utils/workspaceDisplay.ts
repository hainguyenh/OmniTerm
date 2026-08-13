import type { Workspace } from '@omniterm/contract'

export function workspaceLocationLabel(workspace: Workspace | undefined): string {
  if (!workspace) return 'No workspace selected'
  return workspace.folders.length === 1 ? workspace.folders[0].path : `${workspace.folders.length} folders`
}
