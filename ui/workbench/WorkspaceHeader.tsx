import { RADIO_LOOK } from '../ide/features/project-tree/RootCheckbox'
import { IconButton } from '../ide/ui'
import { useSelectedWorkspace } from '../platform/workspaceStore'

import { activeFolders, addFolderToWorkspace, exportWorkspaceFile, setFolderDisabled } from './titlebar/workspaceActions'

const folderLabel = (path: string): string => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path

/**
 * The line under the Project title: how many projects are switched on, the actions of the whole
 * workspace, and the projects that are switched off, each with an unchecked box to activate it again.
 * The workspace's name is on the title row itself.
 */
export function WorkspaceHeader() {
  const workspace = useSelectedWorkspace()
  if (!workspace) return null
  const total = workspace.folders.length
  const enabled = activeFolders(workspace).length
  const off = workspace.folders.filter((folder) => folder.disabled)
  return (
    <div className="flex-none border-b border-[var(--border)] text-[11px]" data-testid="workspace-header">
      <div className="flex items-center gap-1 px-2 py-0.5">
        <span className="min-w-0 flex-1 truncate text-[var(--fg-muted)]" data-testid="workspace-header-count">
          {enabled === total ? `${total} projects` : `${enabled}/${total} projects`}
        </span>
        <IconButton icon="plus" size="small" title="Add Project Folder to Workspace…" onClick={() => void addFolderToWorkspace(workspace.id)} />
        <IconButton icon="export" size="small" title="Save as VS Code Workspace…" onClick={() => void exportWorkspaceFile(workspace)} />
      </div>
      {off.map((folder) => (
        <label key={folder.id} className="flex items-center gap-1 px-2 py-0.5 text-[var(--fg-muted)]" title={folder.path} data-testid="workspace-header-off">
          <input
            type="checkbox"
            className={RADIO_LOOK}
            data-look="radio"
            checked={false}
            aria-label={`${folderLabel(folder.path)} is switched off`}
            onChange={() => void setFolderDisabled(workspace.id, folder, false)}
          />
          <span className="truncate">{folderLabel(folder.path)}</span>
        </label>
      ))}
    </div>
  )
}
