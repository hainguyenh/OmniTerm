import type { Connection, Workspace } from '@omniterm/contract'

import { MONITOR_ICON, PLUG_ICON, SERVER_ICON } from '../shellIcons'

/** One row of the connection tree the Project panel and the Connections tool window share. */
export interface ConnectionTreeNode {
  key: string
  label: string
  icon: string
  /** Muted text after the label (`user@host`, the RDP host). */
  detail?: string
  /** Set on a connection row; absent on a group row. */
  connection?: Connection
  children?: ConnectionTreeNode[]
}

const GROUPS: ReadonlyArray<{ type: Connection['type']; label: string; icon: string; rowIcon: string }> = [
  { type: 'SSH', label: 'SSH', icon: SERVER_ICON, rowIcon: PLUG_ICON },
  { type: 'RDP', label: 'Remote Desktop', icon: MONITOR_ICON, rowIcon: MONITOR_ICON },
  { type: 'LOCAL', label: 'Local shells', icon: 'terminal', rowIcon: 'terminal' },
]

/** Muted sub label of a connection: who and where for SSH, the host for Remote Desktop. */
export function connectionDetail(connection: Connection): string | undefined {
  if (connection.type === 'LOCAL') return undefined
  const host = connection.host?.trim()
  if (!host) return undefined
  const port = connection.port?.trim()
  const defaultPort = connection.type === 'SSH' ? '22' : '3389'
  const at = connection.type === 'SSH' && connection.user?.trim() ? `${connection.user.trim()}@${host}` : host
  return port && port !== defaultPort ? `${at}:${port}` : at
}

/** Display name of a connection; a nameless one shows its address. */
export function connectionLabel(connection: Connection): string {
  return connection.name?.trim() || connectionDetail(connection) || connection.id
}

/** Key of a group row, so a tree can fold or reveal it. */
export const connectionGroupKey = (type: Connection['type'], prefix = '') => `${prefix}conn-group:${type}`

/**
 * Groups the workspace's connections by kind (SSH, Remote Desktop, Local shells), in that order,
 * each in the order the connection provider keeps them. Empty groups are left out.
 */
export function connectionTree(connections: readonly Connection[], keyPrefix = ''): ConnectionTreeNode[] {
  return GROUPS.flatMap((group) => {
    const rows = connections.filter((connection) => connection.type === group.type)
    if (!rows.length) return []
    return [{
      key: connectionGroupKey(group.type, keyPrefix),
      label: group.label,
      icon: group.icon,
      children: rows.map((connection) => ({
        key: `${keyPrefix}conn:${connection.id}`,
        label: connectionLabel(connection),
        icon: group.rowIcon,
        detail: connectionDetail(connection),
        connection,
      })),
    }]
  })
}

/**
 * Every workspace's connections ("All workspaces"): one row per workspace, in catalog order, with
 * its connections grouped by kind below it. A workspace without connections is left out.
 */
export function workspacesConnectionTree(
  workspaces: readonly Workspace[],
  connectionsOf: Readonly<Record<string, readonly Connection[]>>,
): ConnectionTreeNode[] {
  return workspaces.flatMap((workspace) => {
    const children = connectionTree(connectionsOf[workspace.id] ?? [], `ws:${workspace.id}/`)
    if (!children.length) return []
    return [{ key: `ws:${workspace.id}`, label: workspace.name, icon: 'folder', children }]
  })
}

/** Keys of every row that has children, at any depth (what Collapse All folds). */
export function groupKeys(nodes: readonly ConnectionTreeNode[]): string[] {
  return nodes.flatMap((node) => (node.children ? [node.key, ...groupKeys(node.children)] : []))
}
