/**
 * sessionStore.ts — snapshot of the current UI session layout for cross-restart persistence.
 *
 * Saves to localStorage — no Rust backend changes needed. Only LOCAL shell sessions are
 * persisted; SSH and RDP cannot be meaningfully resumed after the remote side has dropped them.
 *
 * The snapshot is versioned and schema-validated on load. Any corrupt or outdated snapshot is
 * silently discarded so the app starts with a clean slate instead of crashing.
 */
import { LAYOUT_MODES, type LayoutMode } from '../themes'

export const SNAPSHOT_KEY = 'omniterm:session-snapshot'
export const SNAPSHOT_VERSION = 1 as const

// ── Types ────────────────────────────────────────────────────────────────────

export interface PersistedTab {
  id: string
  connId: string
  name: string
  /** IndexedDB key holding this tab's saved scrollback, written by the persistence layer. */
  scrollbackKey?: string
}

/** Subset of Connection needed to re-register an ephemeral LOCAL shell on restore. */
export interface PersistedConn {
  /** Original adhoc-* id. Used to correlate tabs before remapping. */
  id: string
  name: string
  /** LocalShell value ('powershell', 'cmd', 'bash', etc.). */
  shell?: string
  workspaceId?: string
  localCwd?: string
  initialCommand?: string
}

export interface PersistedViewGroup {
  id: string
  label: string
  color?: string
  persistent?: boolean
  layoutMode: LayoutMode
  /** Tab ids in each pane slot; null slots are empty. */
  panes: (string | null)[]
  focusedPane: number
}

export interface SessionSnapshot {
  version: typeof SNAPSHOT_VERSION
  activeTabs: PersistedTab[]
  /** Only LOCAL shell connections — SSH/RDP are not restorable. */
  ephemeralConns: PersistedConn[]
  viewGroups: PersistedViewGroup[]
  /** tabId → viewGroupId for tabs that belong to a non-default view group. */
  tabGroups: Record<string, string>
  activeGroupId: string
  layoutMode: LayoutMode
}

// ── Validation ───────────────────────────────────────────────────────────────

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
  if (typeof o['id'] !== 'string' || typeof o['connId'] !== 'string' || typeof o['name'] !== 'string') {
    return false
  }
  if (o['scrollbackKey'] !== undefined && typeof o['scrollbackKey'] !== 'string') {
    return false
  }
  return true
}

function isPersistedConn(v: unknown): v is PersistedConn {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o['id'] !== 'string' || typeof o['name'] !== 'string') return false
  if (o['shell'] !== undefined && typeof o['shell'] !== 'string') return false
  if (o['workspaceId'] !== undefined && typeof o['workspaceId'] !== 'string') return false
  if (o['localCwd'] !== undefined && typeof o['localCwd'] !== 'string') return false
  if (o['initialCommand'] !== undefined && typeof o['initialCommand'] !== 'string') return false
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

function isSessionSnapshot(v: unknown): v is SessionSnapshot {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (o['version'] !== SNAPSHOT_VERSION) return false
  if (!Array.isArray(o['activeTabs'])
    || !(o['activeTabs'] as unknown[]).every(isPersistedTab)) return false
  if (!Array.isArray(o['ephemeralConns'])
    || !(o['ephemeralConns'] as unknown[]).every(isPersistedConn)) return false
  if (!Array.isArray(o['viewGroups'])
    || !(o['viewGroups'] as unknown[]).every(isPersistedViewGroup)) return false
  if (!isStringRecord(o['tabGroups'])) return false
  if (typeof o['activeGroupId'] !== 'string') return false
  if (!isLayoutMode(o['layoutMode'])) return false
  return true
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Persist a session snapshot. Silently no-ops when localStorage is unavailable
 * (e.g. storage quota exceeded, private-browsing lockdown).
 */
export function saveSnapshot(snapshot: SessionSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // Storage is optional — silently ignore quota or access errors.
  }
}

/**
 * Load and validate the persisted snapshot. Returns null when no snapshot exists,
 * when the JSON is malformed, or when the schema or version does not match.
 */
export function loadSnapshot(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSessionSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Remove the persisted snapshot from localStorage. */
export function clearSnapshot(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY)
  } catch {
    // ignore
  }
}
