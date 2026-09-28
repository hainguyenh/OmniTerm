import { useSyncExternalStore } from 'react'

import type { DiscoveredProfile, QuotaSnapshot } from '../src/types'
import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { ProfileQuota, QuotaState, TerminalAgent } from './quotaStore'

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

async function executeProfileFetch(row: DashboardRow, api: AgentQuotaAPI): Promise<void> {
  try {
    const snapshot = await api.fetchUsage({ agent: row.agent, profileDir: row.profileDir, launcher: row.launcher })
    if (snapshot.error) {
      update((current) => ({
        ...current,
        manualReadings: {
          ...current.manualReadings,
          [row.key]: {
            reading: current.manualReadings[row.key]?.reading,
            error: snapshot.message ?? 'The quota update failed.',
            fetching: false,
          },
        },
      }))
    } else {
      update((current) => ({
        ...current,
        manualReadings: {
          ...current.manualReadings,
          [row.key]: { reading: snapshot, error: undefined, fetching: false },
        },
      }))
    }
  } catch (err) {
    update((current) => ({
      ...current,
      manualReadings: {
        ...current.manualReadings,
        [row.key]: {
          reading: current.manualReadings[row.key]?.reading,
          error: (err as Error).message || 'The quota update failed.',
          fetching: false,
        },
      },
    }))
  }
}

export async function fetchInactiveProfile(row: DashboardRow, api: AgentQuotaAPI): Promise<void> {
  update((current) => ({
    ...current,
    manualReadings: {
      ...current.manualReadings,
      [row.key]: { ...current.manualReadings[row.key], fetching: true, error: undefined },
    },
  }))
  await executeProfileFetch(row, api)
}

export async function fetchAllMissingProfiles(rows: DashboardRow[], api: AgentQuotaAPI): Promise<void> {
  const missing = rows.filter((row) => row.activeTerminalCount === 0 && !row.reading && !row.fetching)
  if (missing.length === 0) return
  update((current) => {
    const nextManual = { ...current.manualReadings }
    for (const row of missing) {
      nextManual[row.key] = { ...nextManual[row.key], fetching: true, error: undefined }
    }
    return { ...current, manualReadings: nextManual }
  })
  await Promise.all(missing.map((row) => executeProfileFetch(row, api)))
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
    .map((profile) => ({
      key: profile.key,
      agent: profile.agent,
      profileName: profile.profileName,
      profileDir: profile.profileDir,
      launcher: profile.launcher,
      reading: profile.lastGood,
      error: profile.snapshot?.error ? profile.snapshot.message ?? 'The quota update failed.' : undefined,
      fetching: profile.fetching,
      activeTerminalCount: counts.get(profile.key) ?? 0,
    }))

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
