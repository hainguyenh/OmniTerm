import { useEffect, useMemo } from 'react'
import { create } from 'zustand'

import { IconButton } from '../../ide/ui'
import { isAllScope, selectedWorkspaceId, useSelectedWorkspace, useWorkspaceStore } from '../../platform/workspaceStore'

import { connectionTree, groupKeys, workspacesConnectionTree, type ConnectionTreeNode } from './connectionTree'
import { ConnectionsTree } from './ConnectionsTree'
import {
  addConnection,
  loadAllWorkspaceConnections,
  loadWorkspaceConnections,
  useWorkspaceConnectionsStore,
} from './workspaceConnectionsRoot'

/** Folded group rows of the Connections tool window, shared with its header's Collapse All. */
const useConnectionsView = create<{ collapsed: ReadonlySet<string>; setCollapsed: (collapsed: ReadonlySet<string>) => void }>(
  (set) => ({ collapsed: new Set(), setCollapsed: (collapsed) => set({ collapsed }) }),
)

/** Whether the window lists every workspace: "All workspaces" is picked and there is more than one. */
function useAllScope(): boolean {
  return useWorkspaceStore(isAllScope)
}

/** The rows of the window: the selected workspace's connections, or every workspace's. */
function useConnectionNodes(): ConnectionTreeNode[] {
  const all = useAllScope()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const connections = useWorkspaceConnectionsStore((s) => s.connections)
  const allConnections = useWorkspaceConnectionsStore((s) => s.allConnections)
  return useMemo(
    () => (all ? workspacesConnectionTree(workspaces, allConnections) : connectionTree(connections)),
    [all, workspaces, allConnections, connections],
  )
}

/** Header of the Connections tool window: the workspace they belong to, add one, fold every group. */
export function ConnectionsHeaderActions() {
  const workspace = useSelectedWorkspace()
  const all = useAllScope()
  const providerActive = useWorkspaceConnectionsStore((s) => s.providerActive)
  const nodes = useConnectionNodes()
  return (
    <>
      {all ? (
        <span className="max-w-[12ch] truncate px-1 text-[var(--fg-muted)]" data-feature="p2.connections.workspaceLabel">
          All workspaces
        </span>
      ) : workspace && (
        <span
          className="max-w-[12ch] truncate px-1 text-[var(--fg-muted)]"
          title={`Connections belong to the workspace ${workspace.name}`}
          data-feature="p2.connections.workspaceLabel"
        >
          {workspace.name}
        </span>
      )}
      <IconButton
        icon="plus"
        title={workspace ? `Add SSH / RDP / Local Connection to ${workspace.name}…` : 'Add SSH / RDP / Local Connection…'}
        size="small"
        iconSize={16}
        disabled={!providerActive || !workspace}
        onClick={addConnection}
        data-feature="p2.connections.add"
        data-testid="connections-add-button"
      />
      <IconButton
        icon="collapse-all"
        title="Collapse All"
        size="small"
        iconSize={16}
        onClick={() => useConnectionsView.getState().setCollapsed(new Set(groupKeys(nodes)))}
        data-feature="p2.connections.collapse"
      />
    </>
  )
}

/**
 * Connections of the selected workspace, in the same tree as the Project panel's Connections group;
 * with "All workspaces" picked, every workspace's connections split per workspace.
 */
export function ConnectionsToolWindow() {
  const activeWorkspaceId = useWorkspaceStore((s) => selectedWorkspaceId(s.selection))
  const refresh = useWorkspaceStore((s) => s.refresh)
  const all = useAllScope()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const providerActive = useWorkspaceConnectionsStore((s) => s.providerActive)
  const collapsed = useConnectionsView((s) => s.collapsed)
  const setCollapsed = useConnectionsView((s) => s.setCollapsed)
  const nodes = useConnectionNodes()

  // The catalog is normally loaded by the layout already; this covers a window opened without it.
  useEffect(() => {
    if (!useWorkspaceStore.getState().loaded) void refresh()
  }, [refresh])

  useEffect(() => {
    void loadWorkspaceConnections(activeWorkspaceId)
  }, [activeWorkspaceId])

  useEffect(() => {
    if (all) void loadAllWorkspaceConnections(workspaces.map((workspace) => workspace.id))
  }, [all, workspaces])

  const empty = (
    <div className="flex flex-col items-center gap-2 p-6 text-center text-[var(--fg-muted)]">
      {providerActive ? (
        <>
          <span>{all ? 'No connections in any workspace.' : 'No connections in this workspace.'}</span>
          <button type="button" className="text-[var(--link,var(--accent))] hover:underline" onClick={addConnection}>
            Add connection…
          </button>
        </>
      ) : (
        <span>Enable a connection manager plugin to add SSH and Remote Desktop connections.</span>
      )}
    </div>
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden select-none" data-testid="connections-tool-window" data-feature="p2.connections.tree">
      <ConnectionsTree nodes={nodes} collapsed={collapsed} onCollapsedChange={setCollapsed} empty={empty} />
    </div>
  )
}
