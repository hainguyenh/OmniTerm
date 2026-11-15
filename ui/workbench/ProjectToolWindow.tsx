import { useEffect, useMemo, useState } from 'react'

import { ProjectView } from '../ide/features/project-tree/ProjectView'
import { setMemberFilter, useProjectTree } from '../ide/features/project-tree/store'
import { shortcutLabel } from '../ide/platform/keymap'
import { IconButton } from '../ide/ui'
import { useSelectedWorkspace } from '../platform/workspaceStore'

import { connectionTree } from './connections/connectionTree'
import { ConnectionsTree } from './connections/ConnectionsTree'
import { useWorkspaceConnectionsStore } from './connections/workspaceConnectionsRoot'
import { addFolderToWorkspace, addWorkspaceFromFolder } from './titlebar/workspaceActions'
import { useProjectFilterStore } from './projectFilterStore'
import { CONNECTIONS_ICON } from './shellIcons'

/** Project header: show / hide the Connections group, select the opened file, collapse all. */
export function OmniTermProjectHeaderActions() {
  const alwaysSelect = useProjectTree((s) => s.options.autoscrollFromSource)
  const connectionsVisible = useWorkspaceConnectionsStore((s) => s.visible)
  const providerActive = useWorkspaceConnectionsStore((s) => s.providerActive)
  const toggleConnections = useWorkspaceConnectionsStore((s) => s.toggleVisible)

  return (
    <>
      {providerActive && (
        <IconButton
          icon={CONNECTIONS_ICON}
          title={connectionsVisible ? 'Hide Connections' : 'Show Connections'}
          size="small"
          iconSize={16}
          aria-pressed={connectionsVisible}
          className={connectionsVisible ? 'active' : ''}
          onClick={() => toggleConnections()}
          data-feature="p5.tree.toolbar.toggleConnections"
        />
      )}
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

/**
 * A workspace without project folders: no tree, but its connections stay one double click away
 * (the Project view lists them under every workspace's folders otherwise).
 */
function NoProjectFolders() {
  const workspace = useSelectedWorkspace()
  const connections = useWorkspaceConnectionsStore((s) => s.connections)
  const visible = useWorkspaceConnectionsStore((s) => s.visible && s.providerActive)
  const nodes = useMemo(() => connectionTree(connections), [connections])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
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
      {visible && nodes.length > 0 && (
        <div className="min-h-0 flex-1" data-testid="project-standalone-connections">
          <ConnectionsTree nodes={nodes} collapsed={collapsed} onCollapsedChange={setCollapsed} />
        </div>
      )}
    </div>
  )
}

/**
 * OmniTerm's Project tool window: every project folder of the workspace (filtered by the title
 * bar's project filter), then the workspace's Connections group, in the workbench's project tree.
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
