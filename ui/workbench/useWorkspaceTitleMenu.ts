import type { MenuItem } from '../ide/ui'
import { useProjectTitleMenu } from '../ide/features/project-tree/HeaderActions'
import { useProjectTree } from '../ide/features/project-tree/store'
import { useSelectedWorkspace } from '../platform/workspaceStore'

/**
 * View modes OmniTerm leaves out of the title's dropdown: Project Files is the Project view without
 * External Libraries and Scratches, which OmniTerm already hides by default.
 */
export const HIDDEN_VIEW_MODES: ReadonlySet<string> = new Set(['projectFiles'])

type PlainItem = Extract<MenuItem, { kind?: 'item' }>

const isItem = (item: MenuItem): item is PlainItem => item.kind === undefined || item.kind === 'item'

/**
 * The Project window's title. With several projects the window is the workspace: its dropdown
 * entry reads "Workspace", and the title reads the workspace's name alone (a "Workspace" word
 * beside it left the name only a few characters before the ellipsis).
 */
export function useWorkspaceTitleMenu(): { label: string; items: MenuItem[] } {
  const menu = useProjectTitleMenu()
  const mode = useProjectTree((s) => s.mode)
  const workspace = useSelectedWorkspace()
  const multi = !!workspace && workspace.folders.length > 1
  const items = menu.items
    .filter((item) => !isItem(item) || !HIDDEN_VIEW_MODES.has(item.id ?? ''))
    .map((item) => (multi && isItem(item) && item.id === 'project' ? { ...item, label: 'Workspace' } : item))
  if (mode !== 'project' || !multi) return { ...menu, items }
  return { label: workspace.name, items }
}
