import type { Connection, Workspace } from '../../domain'

type ConnectionType = Connection['type']

/** A row of the Connections tree: a workspace (All workspaces scope), a type group, or a connection. */
export type ConnectionNode =
  | { kind: 'workspace'; key: string; name: string; children: ConnectionNode[] }
  | { kind: 'group'; key: string; type: ConnectionType; children: ConnectionNode[] }
  | { kind: 'connection'; key: string; connection: Connection }

const TYPE_ORDER: readonly ConnectionType[] = ['SSH', 'RDP', 'LOCAL']

const TYPE_LABELS: Record<ConnectionType, string> = {
  SSH: 'SSH',
  RDP: 'Remote Desktop',
  LOCAL: 'Local',
}

const TYPE_ICONS: Record<ConnectionType, string> = {
  SSH: 'file-shell',
  RDP: 'file-windows',
  LOCAL: 'terminal',
}

const DEFAULT_PORTS: Record<ConnectionType, string> = { SSH: '22', RDP: '3389', LOCAL: '' }

const byName = (a: Connection, b: Connection) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

function typeGroups(prefix: string, connections: readonly Connection[]): ConnectionNode[] {
  return TYPE_ORDER.flatMap((type) => {
    const members = connections.filter((connection) => connection.type === type).sort(byName)
    if (!members.length) return []
    return [{
      kind: 'group' as const,
      key: `${prefix}type:${type}`,
      type,
      children: members.map((connection) => ({
        kind: 'connection' as const,
        key: `${prefix}conn:${connection.id}`,
        connection,
      })),
    }]
  })
}

/**
 * The tree roots: type groups (SSH, Remote Desktop, Local) of the scoped workspace, or one node per
 * workspace with its own type groups when every workspace is listed (`workspaceId` null).
 */
export function buildConnectionTree(
  connections: readonly Connection[],
  workspaces: readonly Workspace[],
  workspaceId: string | null,
): ConnectionNode[] {
  if (workspaceId) {
    return typeGroups('', connections.filter((connection) => connection.workspaceId === workspaceId))
  }
  return workspaces.flatMap((workspace) => {
    const children = typeGroups(`ws:${workspace.id}/`, connections.filter((c) => c.workspaceId === workspace.id))
    return children.length ? [{ kind: 'workspace' as const, key: `ws:${workspace.id}`, name: workspace.name, children }] : []
  })
}

/** Every expandable key of the tree, so groups start expanded. */
export function expandableKeys(roots: readonly ConnectionNode[]): string[] {
  return roots.flatMap((node) => (node.kind === 'connection' ? [] : [node.key, ...expandableKeys(node.children)]))
}

export function nodeLabel(node: ConnectionNode): string {
  if (node.kind === 'workspace') return node.name
  if (node.kind === 'group') return TYPE_LABELS[node.type]
  return node.connection.name
}

export function nodeIcon(node: ConnectionNode): string {
  if (node.kind === 'workspace') return 'folder'
  return TYPE_ICONS[node.kind === 'group' ? node.type : node.connection.type]
}

/** The muted detail after a connection: `user@host:port` (default port left out), or the local shell. */
export function nodeDetail(node: ConnectionNode): string | undefined {
  if (node.kind !== 'connection') return node.children.length ? String(countConnections(node.children)) : undefined
  const { type, host, port, user, shell, localCwd } = node.connection
  if (type === 'LOCAL') return [shell, localCwd].filter(Boolean).join(' · ') || undefined
  const address = port && port !== DEFAULT_PORTS[type] ? `${host}:${port}` : host
  return user ? `${user}@${address}` : address
}

function countConnections(nodes: readonly ConnectionNode[]): number {
  return nodes.reduce((total, node) => total + (node.kind === 'connection' ? 1 : countConnections(node.children)), 0)
}
