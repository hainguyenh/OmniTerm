import { IconButton } from '../ide/ui'
import { useSelectedWorkspace } from '../platform/workspaceStore'

import { activeFolders, addFolderToWorkspace, exportWorkspaceFile } from './titlebar/workspaceActions'

/**
 * The line under the Project title: how many projects are switched on and the actions of the
 * whole workspace. A switched-off project stays in the tree below, unchecked and greyed out.
 * The workspace's name is on the title row itself.
 */
export function WorkspaceHeader() {
  const workspace = useSelectedWorkspace()
  if (!workspace) return null
  const total = workspace.folders.length
  const enabled = activeFolders(workspace).length
  return (
    <div className="flex-none border-b border-[var(--border)] text-[11px]" data-testid="workspace-header">
      <div className="flex items-center gap-1 px-2 py-0.5">
        <span className="min-w-0 flex-1 truncate text-[var(--fg-muted)]" data-testid="workspace-header-count">
          {enabled === total ? `${total} projects` : `${enabled}/${total} projects`}
        </span>
        <IconButton icon="plus" size="small" title="Add Project Folder to Workspace…" onClick={() => void addFolderToWorkspace(workspace.id)} />
        <IconButton icon="export" size="small" title="Save as VS Code Workspace…" onClick={() => void exportWorkspaceFile(workspace)} />
      </div>
    </div>
  )
}
