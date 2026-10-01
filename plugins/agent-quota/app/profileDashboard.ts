import { useSyncExternalStore } from 'react'

import type { DiscoveredProfile, QuotaSnapshot } from '../src/types'
import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { HiddenProbeDeps } from './hiddenProfileProbe'
import type { ProfileQuota, QuotaState, TerminalAgent } from './quotaStore'

import { liveHiddenProbeDeps, probeProfilesHidden } from './hiddenProfileProbe'
import { quotaCommands } from './quotaStore'

/** The Profiles dialog is a view of the engine's current terminal/profile state. */

export interface DashboardRow {
  key: string
  agent: ProfileQuota['agent']
  profileName: string
  profileDir: string | null
  launcher: string | null
  /** The engine's last successful reading for this active profile, or manual fetch for inactive. */
  reading?: ProfileQuota['lastGood']
  /** The current error, if its latest read failed. */
  error?: string
  fetching: boolean
  activeTerminalCount: number
}

export interface ManualReading {
  reading?: QuotaSnapshot
  error?: string
  fetching?: boolean
}

export interface DashboardState {
  open: boolean
  discovered: DiscoveredProfile[]
  manualReadings: Record<string, ManualReading>
}

const initialState = (): DashboardState => ({ open: false, discovered: [], manualReadings: {} })

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

export function setDiscoveredProfiles(discovered: DiscoveredProfile[]): void {
  update((current) => ({ ...current, discovered }))
}

function patchReading(key: string, patch: (current: ManualReading | undefined) => ManualReading): void {
  update((current) => ({ ...current, manualReadings: { ...current.manualReadings, [key]: patch(current.manualReadings[key]) } }))
}

function markFetching(rows: readonly DashboardRow[]): void {
  update((current) => {
    const manualReadings = { ...current.manualReadings }
    for (const row of rows) manualReadings[row.key] = { ...manualReadings[row.key], fetching: true, error: undefined }
    return { ...current, manualReadings }
  })
}

function applyReading(key: string, snapshot: QuotaSnapshot, errorOverride?: string): void {
  patchReading(key, (previous) => snapshot.error
    ? { reading: previous?.reading, error: errorOverride ?? snapshot.message ?? 'The quota update failed.', fetching: false }
    : { reading: snapshot, error: undefined, fetching: false })
}

async function backgroundRead(row: DashboardRow, api: AgentQuotaAPI): Promise<QuotaSnapshot> {
  try {
    return await api.fetchUsage({ agent: row.agent, profileDir: row.profileDir, launcher: row.launcher })
  } catch (err) {
    return { windows: [], fetchedAt: Date.now(), error: 'failed', message: (err as Error).message || 'The quota update failed.' }
  }
}

/** One hidden run at a time: a second Fetch waits for the first instead of opening another terminal. */
let hiddenRun: Promise<unknown> = Promise.resolve()

/**
 * Read inactive profiles in the hidden terminal (hiddenProfileProbe.ts). A profile it could not
 * start, or whose panel it could not read, falls back to the sidecar's background read; when that
 * fails too, the hidden run's reason is the one shown.
 */
async function readProfiles(rows: DashboardRow[], api: AgentQuotaAPI, hidden?: HiddenProbeDeps): Promise<void> {
  markFetching(rows)
  const probeDir = api.probeDir?.bind(api)
  const deps = hidden ?? (probeDir ? liveHiddenProbeDeps(probeDir) : null)
  const hiddenErrors = new Map<string, string>()
  let retry = rows
  if (deps) {
    const run = hiddenRun.then(() => probeProfilesHidden(rows, deps, (key, snapshot) => {
      if (snapshot.error) hiddenErrors.set(key, snapshot.message ?? 'The quota update failed.')
      else applyReading(key, snapshot)
    }))
    hiddenRun = run.catch(() => [])
    const skipped = new Set(await run.catch(() => rows.map((row) => row.key)))
    retry = rows.filter((row) => skipped.has(row.key) || hiddenErrors.has(row.key))
  }
  await Promise.all(retry.map(async (row) => applyReading(row.key, await backgroundRead(row, api), hiddenErrors.get(row.key))))
}

export async function fetchProfileRow(row: DashboardRow, api: AgentQuotaAPI, hidden?: HiddenProbeDeps): Promise<void> {
  if (row.activeTerminalCount > 0) {
    quotaCommands().refresh(row.key)
  }
  await readProfiles([row], api, hidden)
}

export async function fetchAllProfiles(rows: DashboardRow[], api: AgentQuotaAPI, hidden?: HiddenProbeDeps): Promise<void> {
  const notFetching = rows.filter((row) => !row.fetching)
  if (notFetching.some((row) => row.activeTerminalCount > 0)) {
    quotaCommands().refresh()
  }
  if (notFetching.length > 0) await readProfiles(notFetching, api, hidden)
}

export async function fetchInactiveProfile(row: DashboardRow, api: AgentQuotaAPI, hidden?: HiddenProbeDeps): Promise<void> {
  await fetchProfileRow(row, api, hidden)
}

export async function fetchAllMissingProfiles(rows: DashboardRow[], api: AgentQuotaAPI, hidden?: HiddenProbeDeps): Promise<void> {
  const missing = rows.filter((row) => row.activeTerminalCount === 0 && !row.reading && !row.fetching)
  if (missing.length === 0) return
  await readProfiles(missing, api, hidden)
}

function activeTerminalCounts(terminals: Record<string, TerminalAgent>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const terminal of Object.values(terminals)) {
    counts.set(terminal.profileKey, (counts.get(terminal.profileKey) ?? 0) + 1)
  }
  return counts
}

function normalizeDir(dir: string): string {
  const lower = dir.trim().toLowerCase()
  const unified = /^[a-z]:[\\/]/.test(lower) ? lower.replace(/\//g, '\\') : lower
  return unified.replace(/[\\/]+$/, '')
}

function discoveredProfileKey(dp: DiscoveredProfile): string {
  if (dp.launcher) return `${dp.agent}:launcher:${dp.launcher.toLowerCase()}`
  if (dp.profileDir) return `${dp.agent}:${normalizeDir(dp.profileDir)}`
  return `${dp.agent}:${dp.profileName.toLowerCase()}`
}

/** Convert the engine snapshot and discovered profiles into stable rows per profile. */
export function dashboardRows(
  state: Pick<QuotaState, 'profiles' | 'terminals'>,
  discovered: DiscoveredProfile[] = [],
  manualReadings: Record<string, ManualReading> = {},
): DashboardRow[] {
  const counts = activeTerminalCounts(state.terminals)
  const activeRows: DashboardRow[] = Object.values(state.profiles)
    .filter((profile) => profile.agent === 'claude' && counts.has(profile.key))
    .map((profile) => {
      const manual = manualReadings[profile.key]
      const reading = manual?.reading && (!profile.lastGood || manual.reading.fetchedAt >= profile.lastGood.fetchedAt)
        ? manual.reading
        : (profile.lastGood ?? manual?.reading)
      return {
        key: profile.key,
        agent: profile.agent,
        profileName: profile.profileName,
        profileDir: profile.profileDir,
        launcher: profile.launcher,
        reading,
        error: manual?.error ?? (profile.snapshot?.error ? profile.snapshot.message ?? 'The quota update failed.' : undefined),
        fetching: profile.fetching || (manual?.fetching ?? false),
        activeTerminalCount: counts.get(profile.key) ?? 0,
      }
    })

  const activeKeys = new Set(activeRows.map((row) => row.key))
  const activeLaunchers = new Set(activeRows.map((row) => row.launcher?.toLowerCase()).filter(Boolean))
  const activeDirs = new Set(activeRows.map((row) => row.profileDir ? normalizeDir(row.profileDir) : null).filter(Boolean))
  const activeNames = new Set(activeRows.map((row) => row.profileName.toLowerCase()))

  const inactiveRows: DashboardRow[] = []
  for (const dp of discovered) {
    if (dp.agent !== 'claude') continue
    const key = discoveredProfileKey(dp)
    if (
      activeKeys.has(key) ||
      (dp.launcher && activeLaunchers.has(dp.launcher.toLowerCase())) ||
      (dp.profileDir && activeDirs.has(normalizeDir(dp.profileDir))) ||
      activeNames.has(dp.profileName.toLowerCase())
    ) {
      continue
    }
    const manual = manualReadings[key]
    inactiveRows.push({
      key,
      agent: dp.agent,
      profileName: dp.profileName,
      profileDir: dp.profileDir,
      launcher: dp.launcher,
      reading: manual?.reading,
      error: manual?.error,
      fetching: manual?.fetching ?? false,
      activeTerminalCount: 0,
    })
  }

  return [...activeRows, ...inactiveRows]
    .sort((left, right) => left.profileName.localeCompare(right.profileName) || left.key.localeCompare(right.key))
}
