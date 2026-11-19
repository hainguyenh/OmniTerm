import { useMemo, useState } from 'react'

import { EmptyState, IconButton, Tree } from '../../ide/ui'
import { isAllScope, scopedWorkspaceId, useSelectedWorkspace, useWorkspaceStore } from '../../platform/workspaceStore'

import { useShellPanels } from '../shellPanelsStore'
import {
  buildConnectionTree,
  expandableKeys,
  nodeDetail,
  nodeIcon,
  nodeLabel,
  type ConnectionNode,
} from './connectionNodes'

export const CONNECTIONS_TOOL_WINDOW = 'omniterm.connections'

const childrenOf = (node: ConnectionNode) => (node.kind === 'connection' ? undefined : node.children)

/**
 * Saved SSH, Remote Desktop and local connections of the workspace in scope, grouped by type (and
 * by workspace under "All workspaces"). Enter or double-click connects; typing filters the tree.
 */
export function ConnectionsToolWindow() {
  const panel = useShellPanels((s) => s.connections)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const workspaceId = useWorkspaceStore(scopedWorkspaceId)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const connections = panel?.connections
  const roots = useMemo(
    () => buildConnectionTree(connections ?? [], workspaces, workspaceId),
    [connections, workspaces, workspaceId],
  )
  const expanded = useMemo(() => new Set(expandableKeys(roots).filter((key) => !collapsed.has(key))), [roots, collapsed])
  if (!panel) return null
  return (
    <Tree<ConnectionNode>
      roots={roots}
      getKey={(node) => node.key}
      getLabel={nodeLabel}
      getChildren={childrenOf}
      isExpandable={(node) => node.kind !== 'connection'}
      getIcon={nodeIcon}
      getDetail={nodeDetail}
      expanded={expanded}
      onExpandedChange={(_next, node, isExpanded) =>
        setCollapsed((current) => {
          const next = new Set(current)
          if (isExpanded) next.delete(node.key)
          else next.add(node.key)
          return next
        })}
      onActivate={(node) => {
        if (node.kind === 'connection') panel.onConnect(node.connection)
      }}
      speedSearch
      speedSearchMode="filter"
      aria-label="Connections"
      empty={(
        <EmptyState title="No saved connections">
          {workspaceId ? 'This workspace has no saved connections.' : 'No workspace has saved connections.'}
        </EmptyState>
      )}
    />
  )
}

/** The Connections header: the workspace in scope and Refresh. */
export function ConnectionsHeaderActions() {
  const workspace = useSelectedWorkspace()
  const all = useWorkspaceStore(isAllScope)
  const refresh = useShellPanels((s) => s.connections?.onRefresh)
  const label = all ? 'All workspaces' : workspace?.name
  return (
    <>
      {label && (
        <span className="truncate max-w-[12ch] px-1 text-[11px] opacity-60" title={`Connections of ${label}`} data-testid="connections-workspace-label">
          {label}
        </span>
      )}
      <IconButton
        icon="refresh"
        title="Refresh"
        size="small"
        disabled={!refresh}
        onClick={() => void refresh?.()}
        data-testid="connections-refresh-button"
      />
    </>
  )
}
