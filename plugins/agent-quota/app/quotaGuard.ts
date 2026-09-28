import type { QuotaSnapshot, WindowKind } from '../src/types'
import type { AgentConfig } from './quotaConfig'

import { allUnderLimit, breachedWindow, isFresh, windowOf } from './quotaPolicy'

/**
 * The quota guard for one agent instance, as a pure state machine the engine steps after every
 * reading. Phases:
 *
 *  active    — watching; crossing a limit (with suspend on) freezes the agent → guarding.
 *  guarding  — the post-suspend watchdog (the quota project's "fallback watchdog"): every step
 *              re-scans the process tree so a sub-agent spawned around the freeze is frozen too,
 *              and two rising readings in a row raise the alarm and restart the watch. After
 *              `guardMinutes` without a rise → suspended.
 *  suspended — waits for the reset (+ delay) and a fresh reading under every limit, then thaws.
 *  stopped   — usage kept climbing past `hardStopAtPct`, so the agent was terminated.
 *
 * Nothing here trusts stale or unparsed data: those readings never suspend and never resume.
 */

export type GuardPhase = 'active' | 'guarding' | 'suspended' | 'stopped'

export interface GuardState {
  phase: GuardPhase
  lastAttemptAt: number
  window?: WindowKind
  frozenPct?: number
  lastPct?: number
  resetsAt?: number
  guardUntil?: number
  risingCount: number
  /** After a manual resume, do not re-freeze before this time. */
  bypassUntil?: number
  /** One "limit reached, suspend is off" notice per window reset. */
  notifiedKey?: string
}

export type GuardAction =
  | { type: 'suspend' }
  | { type: 'rescan' }
  | { type: 'resume'; reason: 'reset' | 'early-reset' }
  | { type: 'terminate' }
  | { type: 'notify'; level: 'info' | 'warning' | 'danger'; message: string }

export interface GuardStep {
  state: GuardState
  actions: GuardAction[]
}

export const INITIAL_GUARD: GuardState = { phase: 'active', lastAttemptAt: 0, risingCount: 0 }

const RETRY_MS = 30_000
const RISING_STEPS = 2
const WINDOW_NAMES: Record<WindowKind, string> = { session: 'session', weekly: 'weekly', monthly: 'monthly' }

export interface GuardInput {
  snapshot: QuotaSnapshot | undefined
  config: AgentConfig
  now: number
  /** Human name for notices, e.g. "Claude Code (claude-work)". */
  subject: string
}

function stepActive(state: GuardState, { snapshot, config, now, subject }: GuardInput): GuardStep {
  const breach = breachedWindow(snapshot, config, now)
  if (!breach) return { state, actions: [] }
  const limit = config.limits[breach.kind]
  const summary = `${Math.round(breach.usedPct)}% ≥ ${limit}% ${WINDOW_NAMES[breach.kind]} limit`
  if (!config.suspendAtLimit) {
    const key = `${breach.kind}:${breach.resetsAt ?? 'none'}`
    if (state.notifiedKey === key) return { state, actions: [] }
    return {
      state: { ...state, notifiedKey: key },
      actions: [{ type: 'notify', level: 'danger', message: `${subject} reached ${summary}. Suspend is off, so it keeps running.` }],
    }
  }
  if (state.bypassUntil !== undefined && now < state.bypassUntil) return { state, actions: [] }
  if (now - state.lastAttemptAt < RETRY_MS) return { state, actions: [] }
  return {
    state: {
      phase: 'guarding',
      lastAttemptAt: now,
      window: breach.kind,
      frozenPct: breach.usedPct,
      lastPct: breach.usedPct,
      resetsAt: breach.resetsAt,
      guardUntil: now + config.guardMinutes * 60_000,
      risingCount: 0,
    },
    actions: [
      { type: 'suspend' },
      { type: 'notify', level: 'warning', message: `${subject} suspended: ${summary}.` },
    ],
  }
}

function resumed(reason: 'reset' | 'early-reset', subject: string): GuardStep {
  const message = reason === 'reset' ? `${subject} resumed after the quota reset.` : `${subject} resumed: quota reset early.`
  return {
    state: { ...INITIAL_GUARD },
    actions: [{ type: 'resume', reason }, { type: 'notify', level: 'info', message }],
  }
}

function stepHeld(state: GuardState, input: GuardInput): GuardStep {
  const { snapshot, config, now, subject } = input
  const actions: GuardAction[] = state.phase === 'guarding' ? [{ type: 'rescan' }] : []
  if (!isFresh(snapshot, now) || !state.window) {
    const expired = state.phase === 'guarding' && state.guardUntil !== undefined && now >= state.guardUntil
    return { state: expired ? { ...state, phase: 'suspended' } : state, actions }
  }
  const limit = config.limits[state.window]
  const current = windowOf(snapshot, state.window)
  const used = current?.usedPct
  // A reset time only moves forward until it passes; after that the reading shows the *next*
  // window's reset, which must not push the resume out by another five hours.
  const resetsAt = state.resetsAt === undefined || state.resetsAt > now ? current?.resetsAt ?? state.resetsAt : state.resetsAt

  if (config.autoResume && used !== undefined && used < limit * 0.5 && (state.frozenPct ?? 0) >= limit * 0.7) {
    return resumed('early-reset', subject)
  }
  const resetDue = resetsAt === undefined || now >= resetsAt + config.resumeDelayMinutes * 60_000
  if (config.autoResume && resetDue && allUnderLimit(snapshot, config, now)) return resumed('reset', subject)

  let next: GuardState = { ...state, resetsAt }
  if (state.phase === 'guarding' && used !== undefined) {
    const rising = used > (state.lastPct ?? state.frozenPct ?? used)
    next = { ...next, lastPct: used, risingCount: rising ? state.risingCount + 1 : 0 }
    if (next.risingCount >= RISING_STEPS) {
      actions.push({
        type: 'notify',
        level: 'danger',
        message: `${subject}: quota still rising while suspended (${Math.round(state.frozenPct ?? used)}% → ${Math.round(used)}%). Re-checking every process.`,
      })
      next = { ...next, risingCount: 0, guardUntil: now + config.guardMinutes * 60_000 }
      if (config.hardStopAtPct !== null && used >= config.hardStopAtPct) {
        actions.push({ type: 'terminate' }, { type: 'notify', level: 'danger', message: `${subject} was stopped at ${Math.round(used)}%.` })
        return { state: { ...next, phase: 'stopped' }, actions }
      }
    }
  }
  if (next.phase === 'guarding' && next.guardUntil !== undefined && now >= next.guardUntil) next = { ...next, phase: 'suspended' }
  return { state: next, actions }
}

export function stepGuard(state: GuardState, input: GuardInput): GuardStep {
  if (state.phase === 'active') return stepActive(state, input)
  if (state.phase === 'stopped') return { state, actions: [] }
  return stepHeld(state, input)
}

/** The engine could not freeze anything: stay active and retry after the back-off. */
export function suspendFailed(state: GuardState): GuardState {
  return { ...INITIAL_GUARD, lastAttemptAt: state.lastAttemptAt, notifiedKey: state.notifiedKey }
}

/** The user resumed by hand: honour it until the window resets (or an hour, without a reset time). */
export function manualResume(state: GuardState, now: number): GuardState {
  return { ...INITIAL_GUARD, bypassUntil: state.resetsAt !== undefined && state.resetsAt > now ? state.resetsAt : now + 3_600_000 }
}

export const isHeld = (state: GuardState | undefined) => state?.phase === 'guarding' || state?.phase === 'suspended'
