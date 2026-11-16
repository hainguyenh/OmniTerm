import { useEffect } from 'react'

import { ProjectView } from '../ide/features/project-tree/ProjectView'
import { setMemberFilter, useProjectTree } from '../ide/features/project-tree/store'
import { shortcutLabel } from '../ide/platform/keymap'
import { IconButton } from '../ide/ui'
import { useSelectedWorkspace } from '../platform/workspaceStore'

import { addFolderToWorkspace, addWorkspaceFromFolder } from './titlebar/workspaceActions'
import { useProjectFilterStore } from './projectFilterStore'

/** Project header: select the opened file, collapse all. */
export function OmniTermProjectHeaderActions() {
  const alwaysSelect = useProjectTree((s) => s.options.autoscrollFromSource)

  return (
    <>
      {!alwaysSelect && (
        <IconButton
          icon="eye"
          action="navigate.selectInProjectView"
          title="Select Opened File"
          shortcut={shortcutLabel('navigate.selectInProjectView')}
          size="small"
          iconSize={16}
          data-feature="p5.tree.toolbar.locate"
        />
      )}
      <IconButton
        icon="collapse-all"
        action="project.collapseAll"
        title="Collapse All"
        size="small"
        iconSize={16}
        data-feature="p5.tree.toolbar.collapse"
      />
    </>
  )
}

export interface ProjectToolWindowProps {
  id?: string
}

/** Keeps the tree on the project the title bar's project filter picked ("All projects" shows each). */
function useProjectFilterSync(): void {
  const filter = useProjectFilterStore((s) => s.filter)
  useEffect(() => {
    setMemberFilter(filter === 'all' ? null : filter)
  }, [filter])
}

/** A workspace without project folders: no tree, only a way to add one. */
function NoProjectFolders() {
  const workspace = useSelectedWorkspace()
  return (
    <div className="flex h-full w-full flex-col overflow-hidden select-none" data-testid="project-empty-state">
      <div className="flex flex-col items-center gap-1 px-4 py-6 text-center text-[var(--fg-muted)]">
        <span>{workspace ? 'No project folders in this workspace' : 'No workspace is open'}</span>
        <button
          type="button"
          className="text-[var(--link,var(--accent))] hover:underline"
          data-testid="project-open-folder-button"
          onClick={() => void (workspace ? addFolderToWorkspace(workspace.id) : addWorkspaceFromFolder())}
        >
          {workspace ? 'Add project folder…' : 'Open folder…'}
        </button>
      </div>
    </div>
  )
}

/**
 * OmniTerm's Project tool window: every project folder of the workspace (filtered by the title
 * bar's project filter), in the workbench's project tree.
 */
export function ProjectToolWindow(_props: ProjectToolWindowProps) {
  const root = useProjectTree((s) => s.root)
  useProjectFilterSync()

  if (!root) return <NoProjectFolders />
  return (
    <div className="flex h-full w-full flex-col overflow-hidden" data-testid="project-tool-window">
      <ProjectView />
    </div>
  )
}
