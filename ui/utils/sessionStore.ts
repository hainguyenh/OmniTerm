/** Durable renderer layout metadata used to reattach or reconstruct daemon-owned PTY sessions. */
import { LAYOUT_MODES, type LayoutMode } from '../themes'
import {
  getPersistencePolicy,
  isPersistencePolicy,
  type TerminalPersistencePolicy,
} from './persistencePolicy'

export const SNAPSHOT_KEY = 'omniterm:session-snapshot'
export const SNAPSHOT_VERSION = 2 as const

export interface PersistedTab {
  id: string
  sessionId: string
  generation: number
  persistencePolicy: TerminalPersistencePolicy
  connId: string
  name: string
  scrollbackKey?: string
}

export interface PersistedConn {
  id: string
  name: string
  type?: 'LOCAL' | 'SSH'
  ephemeral?: boolean
  shell?: string
  workspaceId?: string
  localCwd?: string
  initialCommand?: string
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
}

const VALID_LAYOUT_MODES = new Set<number>(LAYOUT_MODES)

function isLayoutMode(v: unknown): v is LayoutMode {
  return typeof v === 'number' && VALID_LAYOUT_MODES.has(v)
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v as object).every(val => typeof val === 'string')
}

function isPersistedTab(v: unknown): v is PersistedTab {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o['id'] === 'string'
    && typeof o['sessionId'] === 'string'
    && typeof o['generation'] === 'number'
    && isPersistencePolicy(o['persistencePolicy'])
    && typeof o['connId'] === 'string'
    && typeof o['name'] === 'string'
    && (o['scrollbackKey'] === undefined || typeof o['scrollbackKey'] === 'string')
}

function isPersistedConn(v: unknown): v is PersistedConn {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o['id'] !== 'string' || typeof o['name'] !== 'string') return false
  if (o['type'] !== undefined && o['type'] !== 'LOCAL' && o['type'] !== 'SSH') return false
  if (o['ephemeral'] !== undefined && typeof o['ephemeral'] !== 'boolean') return false
  for (const key of ['shell', 'workspaceId', 'localCwd', 'initialCommand', 'host', 'port', 'user']) {
    if (o[key] !== undefined && typeof o[key] !== 'string') return false
  }
  return true
}

function isPersistedViewGroup(v: unknown): v is PersistedViewGroup {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o['id'] === 'string'
    && typeof o['label'] === 'string'
    && isLayoutMode(o['layoutMode'])
    && Array.isArray(o['panes'])
    && (o['panes'] as unknown[]).every(isNullableString)
    && typeof o['focusedPane'] === 'number'
}

function hasCommonSnapshotShape(o: Record<string, unknown>): boolean {
  return Array.isArray(o['activeTabs'])
    && Array.isArray(o['ephemeralConns'])
    && (o['ephemeralConns'] as unknown[]).every(isPersistedConn)
    && Array.isArray(o['viewGroups'])
    && (o['viewGroups'] as unknown[]).every(isPersistedViewGroup)
    && isStringRecord(o['tabGroups'])
    && typeof o['activeGroupId'] === 'string'
    && isLayoutMode(o['layoutMode'])
}

function migrateV1(o: Record<string, unknown>): SessionSnapshot | null {
  if (!hasCommonSnapshotShape(o)) return null
  const tabs = o['activeTabs'] as unknown[]
  const migrated: PersistedTab[] = []
  for (const value of tabs) {
    if (!value || typeof value !== 'object') return null
    const tab = value as Record<string, unknown>
    if (typeof tab['id'] !== 'string' || typeof tab['connId'] !== 'string' || typeof tab['name'] !== 'string') return null
    migrated.push({
      id: tab['id'],
      sessionId: tab['id'],
      generation: 1,
      persistencePolicy: getPersistencePolicy(tab['id']),
      connId: tab['connId'],
      name: tab['name'],
      ...(typeof tab['scrollbackKey'] === 'string' ? { scrollbackKey: tab['scrollbackKey'] } : {}),
    })
  }
  return {
    version: SNAPSHOT_VERSION,
    activeTabs: migrated,
    ephemeralConns: (o['ephemeralConns'] as PersistedConn[]).map(conn => ({ type: 'LOCAL', ephemeral: true, ...conn })),
    viewGroups: o['viewGroups'] as PersistedViewGroup[],
    tabGroups: o['tabGroups'] as Record<string, string>,
    activeGroupId: o['activeGroupId'] as string,
    layoutMode: o['layoutMode'] as LayoutMode,
  }
}

function parseSnapshot(v: unknown): SessionSnapshot | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o['version'] === 1) return migrateV1(o)
  if (o['version'] !== SNAPSHOT_VERSION || !hasCommonSnapshotShape(o)) return null
  if (!(o['activeTabs'] as unknown[]).every(isPersistedTab)) return null
  return o as unknown as SessionSnapshot
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
