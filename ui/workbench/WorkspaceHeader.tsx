import { IconButton } from '../ide/ui'
import { useSelectedWorkspace } from '../platform/workspaceStore'

import { activeFolders, addFolderToWorkspace, exportWorkspaceFile } from './titlebar/workspaceActions'

/**
 * The root line of the Project panel, as VS Code's explorer has it: "name (Workspace)" above the
 * projects, with the number that are switched on and the actions that belong to the whole workspace.
 */
export function WorkspaceHeader() {
  const workspace = useSelectedWorkspace()
  if (!workspace) return null
  const total = workspace.folders.length
  const enabled = activeFolders(workspace).length
  return (
    <div className="flex flex-none items-center gap-1 border-b border-[var(--border)] px-2 py-0.5 text-[11px]" data-testid="workspace-header">
      <span className="min-w-0 flex-1 truncate font-semibold" title={`${workspace.name} (Workspace)`}>
        {workspace.name} <span className="font-normal text-[var(--fg-muted)]">(Workspace)</span>
      </span>
      <span className="flex-none text-[var(--fg-muted)]" data-testid="workspace-header-count">
        {enabled === total ? `${total} projects` : `${enabled}/${total} projects`}
      </span>
      <IconButton icon="plus" size="small" title="Add Project Folder to Workspace…" onClick={() => void addFolderToWorkspace(workspace.id)} />
      <IconButton icon="export" size="small" title="Save as VS Code Workspace…" onClick={() => void exportWorkspaceFile(workspace)} />
    </div>
  )
}
