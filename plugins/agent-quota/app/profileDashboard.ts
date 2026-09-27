import { useSyncExternalStore } from 'react'

import type { AgentKind, DiscoveredProfile, FetchUsageRequest, QuotaSnapshot } from '../src/types'
import type { ProfileQuota } from './quotaStore'

/**
 * State for the Profiles dashboard: every profile the user can start and the last reading the
 * dashboard took of each. Deliberately separate from the engine — nothing here polls, guards or
 * wakes. A reading is taken only when the user presses Fetch; profiles the engine already monitors
 * show whichever reading is newer, the engine's or the dashboard's.
 */

export interface DashboardRow {
  key: string
  agent: AgentKind
  profileName: string
  profileDir: string | null
  launcher: string | null
  /** The last reading without an error. */
  reading?: QuotaSnapshot
  /** Why the last fetch failed; cleared by the next good one. */
  error?: string
  fetching: boolean
}

export interface DashboardState {
  open: boolean
  listing: boolean
  fetchingAll: boolean
  rows: DashboardRow[]
}

export interface DashboardDeps {
  listProfiles(): Promise<DiscoveredProfile[]>
  fetchUsage(request: FetchUsageRequest): Promise<QuotaSnapshot>
}

/** Two `claude -p /usage` runs at a time: each starts a full CLI, so a long list must not fork them all. */
const FETCH_CONCURRENCY = 2

const initialState = (): DashboardState => ({ open: false, listing: false, fetchingAll: false, rows: [] })

let state: DashboardState = initialState()
const listeners = new Set<() => void>()

function update(next: (current: DashboardState) => DashboardState): void {
  const value = next(state)
  if (value === state) return
  state = value
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useProfileDashboard<T>(selector: (current: DashboardState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state))
}

export const getProfileDashboard = (): DashboardState => state

export function resetProfileDashboard(): void {
  state = initialState()
  for (const listener of [...listeners]) listener()
}

export function setDashboardOpen(open: boolean): void {
  update((current) => (current.open === open ? current : { ...current, open }))
}

/** Same key the engine gives a detected profile (quotaEngine.profileKeyOf), so readings line up. */
export function dashboardKey(profile: Pick<DiscoveredProfile, 'agent' | 'launcher' | 'profileDir' | 'profileName'>): string {
  return profile.launcher
    ? `${profile.agent}:launcher:${profile.launcher.toLowerCase()}`
    : `${profile.agent}:${(profile.profileDir ?? profile.profileName).toLowerCase()}`
}

/** The newer good reading of the dashboard's own and the engine's, for a monitored profile. */
export function freshestReading(row: DashboardRow, engine: Record<string, ProfileQuota>): QuotaSnapshot | undefined {
  const monitored = engine[row.key]?.lastGood
  if (!monitored) return row.reading
  if (!row.reading) return monitored
  return monitored.fetchedAt > row.reading.fetchedAt ? monitored : row.reading
}

/**
 * Refresh the list of profiles: the sidecar's discovery plus any profile the engine monitors that
 * discovery cannot see (a custom `CLAUDE_CONFIG_DIR` set by hand). Readings already taken are kept.
 */
export async function loadDashboardProfiles(deps: DashboardDeps, engine: Record<string, ProfileQuota> = {}): Promise<void> {
  update((current) => ({ ...current, listing: true }))
  const discovered = await deps.listProfiles().catch(() => [])
  update((current) => {
    const previous = new Map(current.rows.map((row) => [row.key, row]))
    const rows = new Map<string, DashboardRow>()
    const add = (profile: DiscoveredProfile) => {
      const key = dashboardKey(profile)
      if (rows.has(key)) return
      const kept = previous.get(key)
      rows.set(key, {
        key,
        agent: profile.agent,
        profileName: profile.profileName,
        profileDir: profile.profileDir,
        launcher: profile.launcher,
        reading: kept?.reading,
        error: kept?.error,
        fetching: kept?.fetching ?? false,
      })
    }
    discovered.forEach(add)
    Object.values(engine).forEach(add)
    return { ...current, listing: false, rows: [...rows.values()] }
  })
}

function patchRow(key: string, patch: Partial<DashboardRow>): void {
  update((current) => ({ ...current, rows: current.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)) }))
}

async function fetchRow(deps: DashboardDeps, row: DashboardRow): Promise<void> {
  patchRow(row.key, { fetching: true })
  const snapshot = await deps.fetchUsage({
    agent: row.agent,
    // A launcher sets its own profile directory; passing one as well would override it.
    profileDir: row.launcher ? null : row.profileDir,
    launcher: row.launcher,
  }).catch((error: unknown): QuotaSnapshot => ({ windows: [], fetchedAt: Date.now(), error: 'failed', message: String(error) }))
  if (snapshot.error || snapshot.windows.length === 0) {
    patchRow(row.key, { fetching: false, error: snapshot.message ?? 'The reading could not be taken.' })
  } else {
    patchRow(row.key, { fetching: false, reading: snapshot, error: undefined })
  }
}

/** Read the quota of the given profiles (default: all), a few at a time. Manual only. */
export async function fetchDashboardProfiles(deps: DashboardDeps, keys?: readonly string[]): Promise<void> {
  const wanted = state.rows.filter((row) => !row.fetching && (!keys || keys.includes(row.key)))
  if (wanted.length === 0) return
  const all = !keys
  if (all) update((current) => ({ ...current, fetchingAll: true }))
  const queue = [...wanted]
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) await fetchRow(deps, row)
  }
  try {
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, worker))
  } finally {
    if (all) update((current) => ({ ...current, fetchingAll: false }))
  }
}

/** `just now`, `12m ago`, `3h ago`, `2d ago` — how old a reading is. */
export function formatAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}
