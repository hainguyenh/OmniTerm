import type { MenuItem } from '../ide/ui'
import { useProjectTitleMenu } from '../ide/features/project-tree/HeaderActions'
import { useProjectTree } from '../ide/features/project-tree/store'
import { useSelectedWorkspace } from '../platform/workspaceStore'

/**
 * The Project window's title. With several projects the window is the workspace, so the dropdown
 * reads the workspace's name alone: a "Workspace" word beside it left the name only a few
 * characters before the ellipsis.
 */
export function useWorkspaceTitleMenu(): { label: string; items: MenuItem[] } {
  const menu = useProjectTitleMenu()
  const mode = useProjectTree((s) => s.mode)
  const workspace = useSelectedWorkspace()
  if (mode !== 'project' || !workspace || workspace.folders.length < 2) return menu
  return { ...menu, label: workspace.name }
}
