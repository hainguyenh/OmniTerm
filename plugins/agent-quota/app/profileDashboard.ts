import { useSyncExternalStore } from 'react'

import type { ProfileQuota, QuotaState, TerminalAgent } from './quotaStore'

/** The Profiles dialog is a view of the engine's current terminal/profile state. */

export interface DashboardRow {
  key: string
  agent: ProfileQuota['agent']
  profileName: string
  profileDir: string | null
  launcher: string | null
  /** The engine's last successful reading for this active profile. */
  reading?: ProfileQuota['lastGood']
  /** The current engine error, if its latest read failed. */
  error?: string
  fetching: boolean
  activeTerminalCount: number
}

export interface DashboardState {
  open: boolean
}

const initialState = (): DashboardState => ({ open: false })

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

function activeTerminalCounts(terminals: Record<string, TerminalAgent>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const terminal of Object.values(terminals)) {
    counts.set(terminal.profileKey, (counts.get(terminal.profileKey) ?? 0) + 1)
  }
  return counts
}

/** Convert the engine snapshot into one stable, de-duplicated row per active profile. */
export function dashboardRows(state: Pick<QuotaState, 'profiles' | 'terminals'>): DashboardRow[] {
  const counts = activeTerminalCounts(state.terminals)
  return Object.values(state.profiles)
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
    .sort((left, right) => left.profileName.localeCompare(right.profileName) || left.key.localeCompare(right.key))
}
