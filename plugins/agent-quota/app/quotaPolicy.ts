import type { QuotaSnapshot, QuotaWindow, WindowKind } from '../src/types'
import type { AgentConfig, PaceTier } from './quotaConfig'

/**
 * Zones are fractions of the *limit*, not of 100%: with the limit at 80%, 64% used is already
 * "hot". That way the colours and animations say "how close am I to where I said stop", which is
 * the only question a limit line answers.
 */
export type Zone = 'calm' | 'watch' | 'warm' | 'hot' | 'critical' | 'over'

export const ZONE_STEPS: ReadonlyArray<{ zone: Zone; from: number }> = [
  { zone: 'over', from: 1 },
  { zone: 'critical', from: 0.9 },
  { zone: 'hot', from: 0.8 },
  { zone: 'warm', from: 0.7 },
  { zone: 'watch', from: 0.5 },
  { zone: 'calm', from: 0 },
]

export function zoneFor(usedPct: number, limit: number): Zone {
  const ratio = limit > 0 ? usedPct / limit : 1
  return (ZONE_STEPS.find((step) => ratio >= step.from) ?? ZONE_STEPS[ZONE_STEPS.length - 1]).zone
}

export type Animation = 'none' | 'lightning' | 'fire' | 'burning' | 'danger'

const ANIMATIONS: Record<Zone, Animation> = {
  calm: 'none',
  watch: 'none',
  warm: 'lightning',
  hot: 'fire',
  critical: 'burning',
  over: 'danger',
}

export function animationFor(zone: Zone, enabled: boolean): Animation {
  return enabled ? ANIMATIONS[zone] : 'none'
}

/** Below this much fill a number does not fit inside it, so it is drawn just after the fill. */
const MIN_INSIDE_PCT = 12
/** A danger zone this narrow has no room for its number, so the number sits after the track instead. */
const MAX_DANGER_OUTSIDE_PCT = 5

export interface TrackLabels {
  /** The used number: centred in the fill, or just after it when the fill is too short. */
  used: { text: string; at: number; fill: number; inside: boolean }
  /** The danger zone's size: centred in it, or after the track when too narrow; null at 100% limit. */
  danger: { text: string; at: number; inside: boolean } | null
}

/**
 * Where a quota track draws its numbers, all as % of the track width. The track is
 * `[ used | remaining safe | danger zone ]`, with the danger zone running from the limit to 100%.
 */
export function trackLabels(usedPct: number, limit: number): TrackLabels {
  const fill = Math.min(100, Math.max(0, usedPct))
  const inside = fill >= MIN_INSIDE_PCT
  const dangerWidth = Math.max(0, 100 - limit)
  const dangerInside = dangerWidth > MAX_DANGER_OUTSIDE_PCT
  return {
    used: { text: `${Math.round(fill)}%`, at: inside ? fill / 2 : fill, fill, inside },
    danger: dangerWidth > 0
      ? {
        text: `${Math.round(dangerWidth)}%`,
        at: limit + dangerWidth / 2,
        inside: dangerInside,
      }
      : null,
  }
}

/** Readings older than this are not trusted to suspend anything. */
export const FRESH_MS = 10 * 60_000

export function isFresh(snapshot: QuotaSnapshot | undefined, now: number): snapshot is QuotaSnapshot {
  return !!snapshot && !snapshot.error && snapshot.windows.length > 0 && now - snapshot.fetchedAt <= FRESH_MS
}

export function windowOf(snapshot: QuotaSnapshot | undefined, kind: WindowKind): QuotaWindow | undefined {
  return snapshot?.windows.find((window) => window.kind === kind)
}

/** The window over its limit that runs out soonest to recover (latest reset), if any. */
export function breachedWindow(snapshot: QuotaSnapshot | undefined, config: AgentConfig, now: number): QuotaWindow | null {
  if (!isFresh(snapshot, now)) return null
  const over = snapshot.windows.filter((window) => window.usedPct >= config.limits[window.kind])
  if (over.length === 0) return null
  return over.reduce((worst, window) => ((window.resetsAt ?? Infinity) > (worst.resetsAt ?? Infinity) ? window : worst))
}

/** Every window strictly under its limit — the condition for thawing an agent. */
export function allUnderLimit(snapshot: QuotaSnapshot | undefined, config: AgentConfig, now: number): boolean {
  return isFresh(snapshot, now) && snapshot.windows.every((window) => window.usedPct < config.limits[window.kind])
}

/** The highest used-to-limit ratio across windows, which drives polling speed. */
export function pressure(snapshot: QuotaSnapshot | undefined, config: AgentConfig): number {
  if (!snapshot || snapshot.windows.length === 0) return 0
  return Math.max(...snapshot.windows.map((window) => window.usedPct / Math.max(1, config.limits[window.kind])))
}

/** A line's hover text: reading, limit, friendly reset plus its absolute time, and any breakdown. */
export function lineTooltip(window: QuotaWindow, limit: number, now: number): string {
  const reset = formatReset(window.resetsAt, now)
  const parts = [`${window.label}: ${Math.round(window.usedPct)}% used`, `limit ${limit}%`]
  if (reset && window.resetsAt !== undefined) {
    parts.push(`resets ${reset} (${formatResetAbsolute(window.resetsAt)})`)
  }
  const breakdown = window.breakdown?.map((entry) => `${entry.label}: ${Math.round(entry.usedPct)}%`) ?? []
  return [parts.join(' · '), ...breakdown].join('\n')
}

/** `1h 05m`, `12m`, `45s` until `at`; empty once it has passed. */
export function formatCountdown(at: number | undefined, now: number): string {
  if (at === undefined || at <= now) return ''
  const seconds = Math.round((at - now) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * A friendlier reset: a countdown for anything resetting today, `tomorrow HH:MM` for the next
 * calendar day (in the user's own locale and clock format), and the plain day/hour countdown
 * beyond that — never a bare, unlabelled clock time that could be misread as "in X hours".
 */
export function formatReset(at: number | undefined, now: number): string {
  if (at === undefined || at <= now) return ''
  const dayDiff = Math.round((startOfLocalDay(at) - startOfLocalDay(now)) / DAY_MS)
  if (dayDiff === 1) {
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
    return `tomorrow ${time}`
  }
  return formatCountdown(at, now)
}

/** The absolute local date and time a window resets, for a tooltip's full detail. */
export function formatResetAbsolute(at: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))
}

/**
 * The weekly auto-hide rule (Settings → Agent Quota → "Auto-hide weekly while usage < N%"): the
 * weekly line is hidden while its usage is below the threshold (default 60%), and shows again the
 * moment usage reaches it. A terminal can opt out with its "Show weekly quota" override.
 */
export function shouldHideWeekly(window: QuotaWindow, thresholdOrNow?: number, customThreshold?: number): boolean {
  if (window.kind !== 'weekly') return false
  const threshold = typeof customThreshold === 'number'
    ? customThreshold
    : typeof thresholdOrNow === 'number' && thresholdOrNow <= 100
      ? thresholdOrNow
      : 60
  return window.usedPct < threshold
}

/** The 5h session window's own duration — Claude and Codex both reset it on this cadence. */
const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000
/** Too little of the window has elapsed, or too little used, for a projection to mean anything. */
const PACE_MIN_ELAPSED_MS = 10 * 60 * 1000
const PACE_MIN_USED_PCT = 3

/** How usage projects to the reset, versus the limit — what the pace glyph reflects. */
export function paceTier(window: QuotaWindow, limit: number, now: number): PaceTier | null {
  if (window.kind !== 'session' || window.resetsAt === undefined) return null
  const elapsed = now - (window.resetsAt - SESSION_WINDOW_MS)
  if (elapsed < PACE_MIN_ELAPSED_MS || window.usedPct < PACE_MIN_USED_PCT) return null
  const elapsedFraction = Math.min(1, elapsed / SESSION_WINDOW_MS)
  const projected = window.usedPct / elapsedFraction
  const ratio = limit > 0 ? projected / limit : Infinity
  if (ratio < 0.6) return 'slow'
  if (ratio < 1.0) return 'onTrack'
  if (ratio < 1.5) return 'fast'
  return 'overshooting'
}

/** Upper bounds, in % of the limit used, of the first three header artwork tiers. */
export const HEADER_TIER_BOUNDS = { slow: 40, onTrack: 70, fast: 85 } as const

/**
 * The header busy artwork's tier, from how much of the 5h limit is used (used ÷ limit): up to 40%
 * the cat (slow), up to 70% the horse (on track), up to 85% the airplane (fast), and past that
 * sonic (critical). The art only reflects the room left, so it is readable at a glance; the pace
 * projection stays with the pace glyph. With no reading yet it shows the on-track art.
 */
export function headerLoadingTier(window: QuotaWindow | undefined, limit: number): PaceTier {
  if (!window || limit <= 0) return 'onTrack'
  const usedOfLimit = (window.usedPct / limit) * 100
  if (usedOfLimit <= HEADER_TIER_BOUNDS.slow) return 'slow'
  if (usedOfLimit <= HEADER_TIER_BOUNDS.onTrack) return 'onTrack'
  if (usedOfLimit <= HEADER_TIER_BOUNDS.fast) return 'fast'
  return 'overshooting'
}

/** `Pace: ~72% by reset (limit 90%)` — the same projection the tier above is based on. */
export function paceTooltip(window: QuotaWindow, limit: number, now: number): string {
  const elapsed = now - ((window.resetsAt ?? now) - SESSION_WINDOW_MS)
  const elapsedFraction = Math.min(1, Math.max(0.001, elapsed / SESSION_WINDOW_MS))
  const projected = Math.round(window.usedPct / elapsedFraction)
  return `Pace: ~${projected}% by reset (limit ${limit}%)`
}
