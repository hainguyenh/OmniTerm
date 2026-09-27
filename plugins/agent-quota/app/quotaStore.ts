import { useSyncExternalStore } from 'react'

import type { QuotaSnapshot } from '../src/types'
import type { SessionAgent } from './agentQuotaAPI'
import type { AgentConfig, AgentOverride, QuotaConfig } from './quotaConfig'
import type { GuardState } from './quotaGuard'
import type { Sample } from './smartInterval'
import type { WakeMemory } from './wakePolicy'

import { DEFAULT_QUOTA_CONFIG, effectiveConfig } from './quotaConfig'

/**
 * Agent Quota's shared state, outside React so the engine, the pane strips, the settings tab and
 * the activity-bar icon read one source without threading props through near-full layout files.
 * Updates replace the state object; each slice keeps its reference until it changes, which is what
 * `useSyncExternalStore` selectors need.
 */

/** A terminal's main agent, keyed for override disposal and for sharing quota per profile. */
export interface TerminalAgent extends SessionAgent {
  /** Session + pid + start time: a new agent process in the same terminal is a new instance. */
  instanceKey: string
  profileKey: string
}

export interface ProfileQuota {
  key: string
  agent: SessionAgent['agent']
  profileName: string
  profileDir: string | null
  launcher: string | null
  /** Last reading, possibly an error. */
  snapshot?: QuotaSnapshot
  /** Last reading without an error, shown (marked stale) while newer ones fail. */
  lastGood?: QuotaSnapshot
  history: Sample[]
  errorStreak: number
  nextFetchAt: number
  fetching: boolean
  wake: WakeMemory
  waking: boolean
}

export type NoticeLevel = 'info' | 'warning' | 'danger'

export interface Notice {
  id: number
  level: NoticeLevel
  message: string
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
}

export interface QuotaState {
  available: boolean
  config: QuotaConfig
  terminals: Record<string, TerminalAgent>
  profiles: Record<string, ProfileQuota>
  overrides: Record<string, AgentOverride>
  guards: Record<string, GuardState>
  notices: Notice[]
  quickOpen: boolean
  /** Session whose per-terminal popover is open. */
  editing: string | null
  confirm: ConfirmRequest | null
  /** Coarse clock shared by every countdown, advanced by the engine once a second. */
  now: number
}

export const initialQuotaState = (): QuotaState => ({
  available: false,
  config: DEFAULT_QUOTA_CONFIG,
  terminals: {},
  profiles: {},
  overrides: {},
  guards: {},
  notices: [],
  quickOpen: false,
  editing: null,
  confirm: null,
  now: Date.now(),
})

let state: QuotaState = initialQuotaState()
const listeners = new Set<() => void>()

export const getQuotaState = (): QuotaState => state

export function updateQuota(update: (current: QuotaState) => QuotaState): void {
  const next = update(state)
  if (next === state) return
  state = next
  for (const listener of [...listeners]) listener()
}

export function subscribeQuota(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test hook: back to a pristine store. */
export function resetQuotaStore(): void {
  state = initialQuotaState()
  commands = NO_COMMANDS
  for (const listener of [...listeners]) listener()
}

export function useQuota<T>(selector: (current: QuotaState) => T): T {
  return useSyncExternalStore(subscribeQuota, () => selector(state), () => selector(state))
}

/**
 * The engine's clock, rounded to a coarse bucket so a pane strip doesn't re-render every second
 * just because *some* other profile ticked. Selects the same `state.now` the engine already
 * advances once a second — this only changes how often a *given* subscriber notices, via
 * `useSyncExternalStore`'s `Object.is` check on the bucketed value.
 *
 * Pass the nearest deadline this caller cares about (a window's own `resetsAt`) to get
 * second-level precision once it is under two minutes away; omit it for the coarse 30s cadence.
 */
export function useCoarseNow(nearestDeadlineMs?: number): number {
  return useQuota((current) => {
    const bucketMs = nearestDeadlineMs !== undefined && nearestDeadlineMs - current.now < 120_000 ? 1_000 : 30_000
    return Math.floor(current.now / bucketMs) * bucketMs
  })
}

let nextNoticeId = 1
const MAX_NOTICES = 4

export function pushNotice(level: NoticeLevel, message: string): void {
  const notice = { id: nextNoticeId++, level, message }
  updateQuota((current) => ({ ...current, notices: [...current.notices, notice].slice(-MAX_NOTICES) }))
}

export function dismissNotice(id: number): void {
  updateQuota((current) => ({ ...current, notices: current.notices.filter((notice) => notice.id !== id) }))
}

export function requestConfirm(request: ConfirmRequest | null): void {
  updateQuota((current) => ({ ...current, confirm: request }))
}

export function setQuickOpen(open: boolean): void {
  updateQuota((current) => (current.quickOpen === open ? current : { ...current, quickOpen: open }))
}

export function setEditing(sessionId: string | null): void {
  updateQuota((current) => (current.editing === sessionId ? current : { ...current, editing: sessionId }))
}

/** Replace (or with `null`, drop) one instance's override. */
export function setOverride(instanceKey: string, override: AgentOverride | null): void {
  updateQuota((current) => {
    if (!override && !(instanceKey in current.overrides)) return current
    const overrides = { ...current.overrides }
    if (override) overrides[instanceKey] = override
    else delete overrides[instanceKey]
    return { ...current, overrides }
  })
}

/** Clear the manual-resume bypass when the user explicitly enables monitoring again. */
export function clearManualPause(instanceKey: string): void {
  updateQuota((current) => {
    const guard = current.guards[instanceKey]
    if (!guard?.bypassUntil) return current
    return { ...current, guards: { ...current.guards, [instanceKey]: { ...guard, bypassUntil: undefined } } }
  })
}

export function clearOverrides(): void {
  updateQuota((current) => (Object.keys(current.overrides).length === 0 ? current : { ...current, overrides: {} }))
}

/** The configuration that governs one terminal's agent right now. */
export function terminalConfig(current: QuotaState, terminal: TerminalAgent): AgentConfig {
  return effectiveConfig(current.config.agents[terminal.agent], current.overrides[terminal.instanceKey])
}

/** Actions the UI can ask for; the engine registers the real ones while it runs. */
export interface QuotaCommands {
  saveConfig(config: QuotaConfig): void
  refresh(profileKey?: string): void
  wake(target: { sessionId: string } | 'all'): void
  resume(sessionId: string): void
  resumeAll(): void
  openSettings(): void
}

const NO_COMMANDS: QuotaCommands = {
  saveConfig: () => {},
  refresh: () => {},
  wake: () => {},
  resume: () => {},
  resumeAll: () => {},
  openSettings: () => {},
}

let commands: QuotaCommands = NO_COMMANDS

export const quotaCommands = (): QuotaCommands => commands

export function registerQuotaCommands(next: Partial<QuotaCommands>): () => void {
  commands = { ...commands, ...next }
  return () => {
    commands = NO_COMMANDS
  }
}
