import { useCallback, useMemo } from 'react'

import { Icon, Tree, type TreeRowState } from '../../ide/ui'

import { groupKeys, type ConnectionTreeNode } from './connectionTree'
import { openConnection } from './workspaceConnectionsRoot'

interface ConnectionsTreeProps {
  nodes: readonly ConnectionTreeNode[]
  /** Keys of the folded group rows (every group starts open). */
  collapsed: ReadonlySet<string>
  onCollapsedChange: (collapsed: Set<string>) => void
  empty?: React.ReactNode
}

const getKey = (node: ConnectionTreeNode) => node.key
const getLabel = (node: ConnectionTreeNode) => node.label
const getChildren = (node: ConnectionTreeNode) => node.children
const isExpandable = (node: ConnectionTreeNode) => !!node.children

function renderNode(node: ConnectionTreeNode, _state: TreeRowState) {
  const group = !node.connection
  return (
    <span
      className="flex min-w-0 items-center gap-[2px] overflow-hidden"
      data-testid={node.connection ? `connection-row-${node.connection.id}` : undefined}
      title={node.connection ? `${node.label}${node.detail ? ` (${node.detail})` : ''}: double click to open a session` : undefined}
    >
      <Icon name={node.icon} size={16} className="flex-none text-[var(--fg-muted)]" />
      {/* The name keeps its width; the muted address gives way first, as in the Project view. */}
      <span className={`ml-[3px] max-w-full shrink-0 truncate${group ? ' font-semibold text-[var(--fg-strong)]' : ''}`}>{node.label}</span>
      {node.detail && <span className="ml-[5px] min-w-0 truncate text-[var(--fg-subtle)]">{node.detail}</span>}
    </span>
  )
}

/**
 * The connections of the workspace grouped by kind, with the Project view's tree rows. Double click
 * (or Enter) opens a session on a connection in the focused pane.
 */
export function ConnectionsTree({ nodes, collapsed, onCollapsedChange, empty }: ConnectionsTreeProps) {
  const expanded = useMemo(
    () => new Set(groupKeys(nodes).filter((key) => !collapsed.has(key))),
    [nodes, collapsed],
  )
  const onExpandedChange = useCallback(
    (_next: Set<string>, node: ConnectionTreeNode, isExpanded: boolean) => {
      const next = new Set(collapsed)
      if (isExpanded) next.delete(node.key)
      else next.add(node.key)
      onCollapsedChange(next)
    },
    [collapsed, onCollapsedChange],
  )
  const onActivate = useCallback((node: ConnectionTreeNode) => {
    if (node.connection) openConnection(node.connection)
  }, [])
  return (
    <Tree
      roots={nodes}
      getKey={getKey}
      getLabel={getLabel}
      getChildren={getChildren}
      isExpandable={isExpandable}
      renderNode={renderNode}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      onActivate={onActivate}
      speedSearch
      aria-label="Connections"
      empty={empty}
    />
  )
}
