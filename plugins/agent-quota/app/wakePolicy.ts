import type { QuotaSnapshot } from '../src/types'
import type { AgentConfig } from './quotaConfig'

import { windowOf } from './quotaPolicy'

/**
 * When to send a profile its wake-up prompt, which starts a new session window at a chosen time.
 *
 * Only *active* profiles are ever asked (the engine evaluates profiles with an open agent terminal
 * and nothing else). A suspended profile still wakes: the schedule is anchored to its reset, which
 * is exactly when it can work again. The one reason to skip is a spent week, where a new session
 * window would buy nothing.
 */

export interface WakeMemory {
  /** The last wake fired, as a key per window or per day, so each fires once. */
  lastKey?: string
  /** The session reset the next `afterReset` wake is anchored to. */
  sessionReset?: number
}

/** A wake fires within this long after its target, then is considered missed. */
export const WAKE_WINDOW_MS = 5 * 60_000

/**
 * Track the session reset. Once a reset has passed, the reading already shows the *next* one, so
 * the passed reset is kept until its wake window is over.
 */
export function rememberReset(memory: WakeMemory, snapshot: QuotaSnapshot | undefined, delayMinutes: number, now: number): WakeMemory {
  const next = windowOf(snapshot, 'session')?.resetsAt
  if (next === undefined || next === memory.sessionReset) return memory
  const held = memory.sessionReset
  const pending = held !== undefined && held <= now && now < held + delayMinutes * 60_000 + WAKE_WINDOW_MS
  return pending ? memory : { ...memory, sessionReset: next }
}

function localDayKey(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function weekSpent(snapshot: QuotaSnapshot | undefined, config: AgentConfig): boolean {
  const weekly = windowOf(snapshot, 'weekly')
  return !!weekly && weekly.usedPct >= config.limits.weekly
}

/** The key of a wake due now, or null. */
export function dueWake(config: AgentConfig, memory: WakeMemory, snapshot: QuotaSnapshot | undefined, now: number): string | null {
  const { wake } = config
  if (wake.mode === 'off' || weekSpent(snapshot, config)) return null
  if (wake.mode === 'afterReset') {
    const reset = memory.sessionReset
    if (reset === undefined) return null
    const target = reset + wake.delayMinutes * 60_000
    const key = `reset:${reset}`
    return now >= target && now < target + WAKE_WINDOW_MS && memory.lastKey !== key ? key : null
  }
  const [hours, minutes] = wake.time.split(':').map(Number)
  const today = new Date(now)
  const target = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes).getTime()
  const key = `day:${localDayKey(now)}`
  return now >= target && now < target + WAKE_WINDOW_MS && memory.lastKey !== key ? key : null
}
