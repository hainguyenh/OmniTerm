import type { QuotaSnapshot, QuotaWindow } from '../src/types'

import { formatCountdown, windowOf } from './quotaPolicy'

/**
 * Which profile to start right now, for the Profiles dashboard. Pure: readings, the user's global
 * limits and the clock in, a ranking with a one-line reason per profile out.
 *
 * The rules, in order:
 *  1. A window whose reset time has passed counts as 0% used — its quota is back, even if the last
 *     reading predates the reset.
 *  2. A profile with no reading is listed but never recommended.
 *  3. A profile at or over its 5h or weekly limit is "limited" until the later of the resets that
 *     would free it; limited profiles are ranked by when they free up.
 *  4. Usable profiles are scored on three things, each 0–1 before weighting:
 *     - 5h room (45): how much of the session limit is left — what you can spend right now;
 *     - weekly room (20): how much of the weekly limit is left;
 *     - use it or lose it (35): weekly room that expires within two days, counted only as far as
 *       the 5h room lets you spend it now. Quota that resets soon is worth spending first.
 *     A profile with under 10% of its weekly limit left has its score halved: one session would
 *     finish the week.
 *  5. The best-scoring usable profile is "Use now"; the next is the alternative. When nothing is
 *     usable, the limited profile that frees up first is named instead.
 */

export interface AdvisorProfile {
  key: string
  name: string
  /** The latest reading without an error, if there is one. */
  reading?: QuotaSnapshot
}

export interface AdvisorLimits {
  session: number
  weekly: number
}

export type AdviceStatus = 'best' | 'ok' | 'limited' | 'noData'

export interface ProfileAdvice {
  key: string
  name: string
  status: AdviceStatus
  /** 0–100; only meaningful between usable profiles. */
  score: number
  reason: string
  /** Percentage points left before the 5h / weekly limit, after rule 1. */
  sessionLeft?: number
  weeklyLeft?: number
  /** When a limited profile can be used again, if its reset time is known. */
  availableAt?: number
}

export interface Recommendation {
  best: ProfileAdvice | null
  alternative: ProfileAdvice | null
  /** Set only when no profile is usable: the one that frees up first. */
  nextAvailable: ProfileAdvice | null
  ranked: ProfileAdvice[]
}

const WEIGHTS = { session: 45, weekly: 20, urgency: 35 } as const
/** Weekly room resetting sooner than this starts counting as "use it or lose it". */
const LOSE_IT_MS = 2 * 24 * 60 * 60 * 1000
const LOW_WEEKLY = 0.1
const URGENT_REASON = 0.25

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

function usedNow(window: QuotaWindow | undefined, now: number): number | undefined {
  if (!window) return undefined
  return window.resetsAt !== undefined && window.resetsAt <= now ? 0 : window.usedPct
}

function freesAt(windows: Array<QuotaWindow | undefined>): number | undefined {
  const times = windows.map((window) => window?.resetsAt)
  return times.some((time) => time === undefined) ? undefined : Math.max(...(times as number[]))
}

function adviseOne(profile: AdvisorProfile, limits: AdvisorLimits, now: number): ProfileAdvice {
  const base = { key: profile.key, name: profile.name, score: 0 }
  const session = windowOf(profile.reading, 'session')
  const weekly = windowOf(profile.reading, 'weekly')
  const sessionUsed = usedNow(session, now)
  const weeklyUsed = usedNow(weekly, now)
  if (sessionUsed === undefined && weeklyUsed === undefined) {
    return { ...base, status: 'noData', reason: 'No reading yet — fetch to compare it' }
  }
  const sessionLeft = sessionUsed === undefined ? undefined : Math.max(0, limits.session - sessionUsed)
  const weeklyLeft = weeklyUsed === undefined ? undefined : Math.max(0, limits.weekly - weeklyUsed)
  const room = { ...base, sessionLeft, weeklyLeft }

  const blocked = [
    weeklyLeft === 0 ? { window: weekly, label: 'Weekly' } : null,
    sessionLeft === 0 ? { window: session, label: '5h' } : null,
  ].filter((entry): entry is { window: QuotaWindow | undefined; label: string } => entry !== null)
  if (blocked.length > 0) {
    const availableAt = freesAt(blocked.map((entry) => entry.window))
    const wait = formatCountdown(availableAt, now)
    const what = `${blocked.map((entry) => entry.label).join(' and ')} limit reached`
    return { ...room, status: 'limited', availableAt, reason: wait ? `${what} — available in ${wait}` : what }
  }

  const sessionFrac = sessionLeft === undefined ? 0.5 : clamp01(sessionLeft / Math.max(1, limits.session))
  const weeklyFrac = weeklyLeft === undefined ? 1 : clamp01(weeklyLeft / Math.max(1, limits.weekly))
  const weeklyResetIn = weekly?.resetsAt === undefined ? undefined : weekly.resetsAt - now
  const expiring = weeklyResetIn === undefined ? 0 : clamp01(1 - weeklyResetIn / LOSE_IT_MS)
  const urgency = expiring * clamp01(weeklyFrac * 2) * clamp01(sessionFrac * 2)
  let score = WEIGHTS.session * sessionFrac + WEIGHTS.weekly * weeklyFrac + WEIGHTS.urgency * urgency
  if (weeklyFrac < LOW_WEEKLY) score /= 2

  const parts = [sessionLeft === undefined ? '5h unknown' : `${Math.round(sessionLeft)}% of 5h left`]
  if (urgency >= URGENT_REASON && weeklyResetIn !== undefined) {
    parts.push(`weekly resets in ${formatCountdown(weekly?.resetsAt, now)} — spend it before it expires`)
  } else if (weeklyLeft !== undefined) {
    parts.push(weeklyFrac < LOW_WEEKLY ? `only ${Math.round(weeklyLeft)}% of weekly left` : `${Math.round(weeklyLeft)}% of weekly left`)
  }
  return { ...room, status: 'ok', score: Math.round(score * 10) / 10, reason: parts.join(' · ') }
}

const byName = (left: ProfileAdvice, right: ProfileAdvice) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)

export function adviseProfiles(profiles: readonly AdvisorProfile[], limits: AdvisorLimits, now: number): Recommendation {
  const all = profiles.map((profile) => adviseOne(profile, limits, now))
  const usable = all.filter((advice) => advice.status === 'ok').sort((left, right) => right.score - left.score || byName(left, right))
  const limited = all
    .filter((advice) => advice.status === 'limited')
    .sort((left, right) => (left.availableAt ?? Infinity) - (right.availableAt ?? Infinity) || byName(left, right))
  const noData = all.filter((advice) => advice.status === 'noData').sort(byName)
  const ranked = [
    ...usable.map((advice, index): ProfileAdvice => (index === 0 ? { ...advice, status: 'best' } : advice)),
    ...limited,
    ...noData,
  ]
  const best = ranked[0]?.status === 'best' ? ranked[0] : null
  return {
    best,
    alternative: best ? ranked[1]?.status === 'ok' ? ranked[1] : null : null,
    nextAvailable: best ? null : limited[0] ?? null,
    ranked,
  }
}
