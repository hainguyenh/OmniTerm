import type { Workspace, WorkspaceColor, WorkspaceIcon } from '../../domain'

import type { MenuItem } from '../../ide/ui/Menu'
import { confirm } from '../../ide/workbench/messages'
import { promptInput } from '../../ide/workbench/inputDialogs'

import { exportWorkspaceFile, removeWorkspace, renameWorkspace, setWorkspaceAppearance } from './workspaceActions'

/** The icons a workspace can wear, with the IDE icon that draws each. */
export const WORKSPACE_ICON_CHOICES: ReadonlyArray<{ id: WorkspaceIcon; label: string; icon: string }> = [
  { id: 'folder', label: 'Folder', icon: 'folder' },
  { id: 'briefcase', label: 'Briefcase', icon: 'toolwindow-project' },
  { id: 'layers', label: 'Layers', icon: 'list' },
  { id: 'code', label: 'Code', icon: 'terminal' },
  { id: 'server', label: 'Server', icon: 'server' },
  { id: 'star', label: 'Star', icon: 'star' },
]

export const WORKSPACE_COLOR_CHOICES: readonly WorkspaceColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray']

const capitalized = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

/** The IDE icon for a workspace's chosen icon, or null for the default initials badge. */
export const workspaceIconName = (icon: WorkspaceIcon | undefined): string | null =>
  WORKSPACE_ICON_CHOICES.find((choice) => choice.id === icon)?.icon ?? null

/** Right-click menu of a workspace: rename, icon, colour and delete (the folders stay on disk). */
export function workspaceMenuItems(workspace: Workspace): MenuItem[] {
  return [
    {
      label: 'Rename…',
      icon: 'edit',
      run: () =>
        void promptInput({ title: 'Rename Workspace', label: 'Workspace name:', okLabel: 'Rename', initial: workspace.name }).then(
          (name) => (name ? renameWorkspace(workspace, name) : undefined),
        ),
    },
    {
      label: 'Icon',
      submenu: [
        ...WORKSPACE_ICON_CHOICES.map((choice): MenuItem => ({
          label: choice.label,
          icon: choice.icon,
          checked: workspace.icon === choice.id,
          run: () => void setWorkspaceAppearance(workspace, workspace.color, choice.id),
        })),
        { kind: 'separator' },
        { label: 'Default (initials)', run: () => void setWorkspaceAppearance(workspace, workspace.color, undefined) },
      ],
    },
    {
      label: 'Color',
      submenu: [
        ...WORKSPACE_COLOR_CHOICES.map((color): MenuItem => ({
          label: capitalized(color),
          checked: workspace.color === color,
          run: () => void setWorkspaceAppearance(workspace, color, workspace.icon),
        })),
        { kind: 'separator' },
        { label: 'No color', run: () => void setWorkspaceAppearance(workspace, undefined, workspace.icon) },
      ],
    },
    { label: 'Save as VS Code Workspace…', icon: 'export', run: () => void exportWorkspaceFile(workspace) },
    { kind: 'separator' },
    {
      label: 'Delete Workspace…',
      icon: 'trash',
      danger: true,
      run: () =>
        void confirm({
          title: 'Delete Workspace',
          message: `Remove "${workspace.name}" from OmniTerm? Its project folders stay on disk.`,
          ok: 'Delete',
          icon: 'warning',
        }).then((yes) => (yes ? removeWorkspace(workspace) : undefined)),
    },
  ]
}
