import type { Connection, Workspace } from '../../domain'

type ConnectionType = Connection['type']

/** A row of the Connections tree: a workspace (All workspaces scope), a type group, or a connection. */
export type ConnectionNode =
  | { kind: 'workspace'; key: string; name: string; children: ConnectionNode[] }
  | { kind: 'group'; key: string; type: ConnectionType; children: ConnectionNode[] }
  | { kind: 'connection'; key: string; connection: Connection }
  | { kind: 'active'; key: string; children: ConnectionNode[] }
  | { kind: 'ssh-session'; key: string; session: LocalSshSession; terminal: string }

/** An `ssh` running in a local terminal, with the terminal's name. */
export interface ActiveSsh {
  session: LocalSshSession
  terminal: string
}

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
  active: readonly ActiveSsh[] = [],
): ConnectionNode[] {
  const saved = workspaceId
    ? typeGroups('', connections.filter((connection) => connection.workspaceId === workspaceId))
    : workspaces.flatMap((workspace) => {
      const children = typeGroups(`ws:${workspace.id}/`, connections.filter((c) => c.workspaceId === workspace.id))
      return children.length ? [{ kind: 'workspace' as const, key: `ws:${workspace.id}`, name: workspace.name, children }] : []
    })
  return active.length ? [activeGroup(active), ...saved] : saved
}

/** The `ssh` sessions typed in terminals: not saved, so above every workspace and type group. */
function activeGroup(active: readonly ActiveSsh[]): ConnectionNode {
  return {
    kind: 'active',
    key: 'active',
    children: active.map(({ session, terminal }) => ({
      kind: 'ssh-session' as const,
      key: `ssh:${session.sessionId}:${session.pid}`,
      session,
      terminal,
    })),
  }
}

/** `user@host:port` of an ssh session (the default port left out). */
export function sshAddress({ user, host, port }: Pick<LocalSshSession, 'user' | 'host' | 'port'>): string {
  const address = port && port !== DEFAULT_PORTS.SSH ? `${host}:${port}` : host
  return user ? `${user}@${address}` : address
}

/** Every expandable key of the tree, so groups start expanded. */
export function expandableKeys(roots: readonly ConnectionNode[]): string[] {
  return roots.flatMap((node) => (isLeaf(node) ? [] : [node.key, ...expandableKeys(node.children)]))
}

export function isLeaf(node: ConnectionNode): node is Extract<ConnectionNode, { kind: 'connection' | 'ssh-session' }> {
  return node.kind === 'connection' || node.kind === 'ssh-session'
}

export function nodeLabel(node: ConnectionNode): string {
  if (node.kind === 'workspace') return node.name
  if (node.kind === 'group') return TYPE_LABELS[node.type]
  if (node.kind === 'active') return 'Active SSH (not saved)'
  if (node.kind === 'ssh-session') return sshAddress(node.session)
  return node.connection.name
}

export function nodeIcon(node: ConnectionNode): string {
  if (node.kind === 'workspace') return 'folder'
  if (node.kind === 'active' || node.kind === 'ssh-session') return TYPE_ICONS.SSH
  return TYPE_ICONS[node.kind === 'group' ? node.type : node.connection.type]
}

/** The muted detail after a connection: `user@host:port` (default port left out), or the local shell. */
export function nodeDetail(node: ConnectionNode): string | undefined {
  if (node.kind === 'ssh-session') return node.terminal || undefined
  if (node.kind !== 'connection') return node.children.length ? String(countConnections(node.children)) : undefined
  const { type, host, port, user, shell, localCwd } = node.connection
  if (type === 'LOCAL') return [shell, localCwd].filter(Boolean).join(' · ') || undefined
  const address = port && port !== DEFAULT_PORTS[type] ? `${host}:${port}` : host
  return user ? `${user}@${address}` : address
}

function countConnections(nodes: readonly ConnectionNode[]): number {
  return nodes.reduce((total, node) => total + (isLeaf(node) ? 1 : countConnections(node.children)), 0)
}
