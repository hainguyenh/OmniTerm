/** Durable renderer metadata for pane layout and terminal working directories. */
import { LAYOUT_MODES, type LayoutMode } from '../themes'
import type { PaneRecoveryContext } from './sessionRecoveryTypes'

export const SNAPSHOT_KEY = 'omniterm:session-snapshot'
export const SNAPSHOT_VERSION = 4 as const

export interface PersistedTab {
  id: string
  connId: string
  name: string
  recovery: PaneRecoveryContext
}

export interface PersistedConn {
  id: string
  name: string
  type?: 'LOCAL' | 'SSH'
  ephemeral?: boolean
  shell?: string
  workspaceId?: string
  localCwd?: string
  host?: string
  port?: string
  user?: string
}

export interface PersistedViewGroup {
  id: string
  label: string
  color?: string
  persistent?: boolean
  layoutMode: LayoutMode
  panes: (string | null)[]
  focusedPane: number
}

export interface SessionSnapshot {
  version: typeof SNAPSHOT_VERSION
  activeTabs: PersistedTab[]
  ephemeralConns: PersistedConn[]
  viewGroups: PersistedViewGroup[]
  tabGroups: Record<string, string>
  activeGroupId: string
  layoutMode: LayoutMode
  revision: number
}

const VALID_LAYOUT_MODES = new Set<number>(LAYOUT_MODES)

function isLayoutMode(value: unknown): value is LayoutMode {
  return typeof value === 'number' && VALID_LAYOUT_MODES.has(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as object).every(entry => typeof entry === 'string')
}

function isRecoveryContext(value: unknown): value is PaneRecoveryContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const context = value as Record<string, unknown>
  return (context['cwd'] === undefined || typeof context['cwd'] === 'string')
    && (context['shell'] === undefined || typeof context['shell'] === 'string')
    && (context['cwdSource'] === 'reported' || context['cwdSource'] === 'launch' || context['cwdSource'] === 'unknown')
}

function isPersistedViewGroup(value: unknown): value is PersistedViewGroup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const group = value as Record<string, unknown>
  return typeof group['id'] === 'string'
    && typeof group['label'] === 'string'
    && isLayoutMode(group['layoutMode'])
    && Array.isArray(group['panes'])
    && (group['panes'] as unknown[]).every(isNullableString)
    && Number.isInteger(group['focusedPane'])
}

function sanitizeConnection(value: unknown): PersistedConn | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const conn = value as Record<string, unknown>
  if (typeof conn['id'] !== 'string' || typeof conn['name'] !== 'string') return null
  if (conn['type'] !== undefined && conn['type'] !== 'LOCAL' && conn['type'] !== 'SSH') return null
  if (conn['ephemeral'] !== undefined && typeof conn['ephemeral'] !== 'boolean') return null
  for (const key of ['shell', 'workspaceId', 'localCwd', 'host', 'port', 'user']) {
    if (conn[key] !== undefined && typeof conn[key] !== 'string') return null
  }
  return {
    id: conn['id'],
    name: conn['name'],
    ...(conn['type'] ? { type: conn['type'] as 'LOCAL' | 'SSH' } : {}),
    ...(typeof conn['ephemeral'] === 'boolean' ? { ephemeral: conn['ephemeral'] } : {}),
    ...(typeof conn['shell'] === 'string' ? { shell: conn['shell'] } : {}),
    ...(typeof conn['workspaceId'] === 'string' ? { workspaceId: conn['workspaceId'] } : {}),
    ...(typeof conn['localCwd'] === 'string' ? { localCwd: conn['localCwd'] } : {}),
    ...(typeof conn['host'] === 'string' ? { host: conn['host'] } : {}),
    ...(typeof conn['port'] === 'string' ? { port: conn['port'] } : {}),
    ...(typeof conn['user'] === 'string' ? { user: conn['user'] } : {}),
  }
}

function recoveryFromLegacy(tab: Record<string, unknown>, conn: PersistedConn | undefined): PaneRecoveryContext {
  const raw = tab['recovery']
  if (isRecoveryContext(raw)) {
    return {
      ...(raw.cwd ? { cwd: raw.cwd } : {}),
      cwdSource: raw.cwdSource,
      ...(raw.shell ? { shell: raw.shell } : {}),
    }
  }

  const legacy = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const cwd = typeof legacy['cwd'] === 'string' ? legacy['cwd'] : conn?.localCwd
  const shell = typeof legacy['shell'] === 'string' ? legacy['shell'] : conn?.shell
  const cwdSource = legacy['cwdSource'] === 'reported' || legacy['cwdSource'] === 'launch' || legacy['cwdSource'] === 'unknown'
    ? legacy['cwdSource']
    : cwd ? 'launch' : 'unknown'
  return {
    ...(cwd ? { cwd } : {}),
    cwdSource,
    ...(shell ? { shell } : {}),
  }
}

function parseSnapshot(value: unknown): SessionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const version = raw['version']
  if (version !== 1 && version !== 2 && version !== 3 && version !== SNAPSHOT_VERSION) return null
  if (!Array.isArray(raw['activeTabs']) || !Array.isArray(raw['ephemeralConns']) || !Array.isArray(raw['viewGroups'])) return null
  if (!(raw['viewGroups'] as unknown[]).every(isPersistedViewGroup)) return null
  if (!isStringRecord(raw['tabGroups']) || typeof raw['activeGroupId'] !== 'string' || !isLayoutMode(raw['layoutMode'])) return null

  const ephemeralConns: PersistedConn[] = []
  for (const value of raw['ephemeralConns'] as unknown[]) {
    const conn = sanitizeConnection(value)
    if (!conn) return null
    ephemeralConns.push(conn)
  }
  const connById = new Map(ephemeralConns.map(conn => [conn.id, conn]))

  const activeTabs: PersistedTab[] = []
  for (const value of raw['activeTabs'] as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const tab = value as Record<string, unknown>
    if (typeof tab['id'] !== 'string' || typeof tab['connId'] !== 'string' || typeof tab['name'] !== 'string') return null
    if (version === SNAPSHOT_VERSION && !isRecoveryContext(tab['recovery'])) return null
    activeTabs.push({
      id: tab['id'],
      connId: tab['connId'],
      name: tab['name'],
      recovery: recoveryFromLegacy(tab, connById.get(tab['connId'])),
    })
  }

  const revision = version === 3 || version === SNAPSHOT_VERSION ? raw['revision'] : 0
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return null

  return {
    version: SNAPSHOT_VERSION,
    activeTabs,
    ephemeralConns,
    viewGroups: (raw['viewGroups'] as PersistedViewGroup[]).map(group => ({
      id: group.id,
      label: group.label,
      ...(group.color !== undefined ? { color: group.color } : {}),
      ...(group.persistent !== undefined ? { persistent: group.persistent } : {}),
      layoutMode: group.layoutMode,
      panes: [...group.panes],
      focusedPane: group.focusedPane,
    })),
    tabGroups: { ...(raw['tabGroups'] as Record<string, string>) },
    activeGroupId: raw['activeGroupId'],
    layoutMode: raw['layoutMode'],
    revision: revision as number,
  }
}

export function saveSnapshot(snapshot: SessionSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // Storage is optional.
  }
}

export function loadSnapshot(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    return raw ? parseSnapshot(JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY)
  } catch {
    // Storage is optional.
  }
}
