import { describe, expect, it } from 'vitest'

import type { QuotaSnapshot } from '../src/types'

import { DEFAULT_QUOTA_CONFIG } from './quotaConfig'
import {
  allUnderLimit,
  animationFor,
  breachedWindow,
  formatCountdown,
  formatReset,
  headerLoadingTier,
  isFresh,
  paceTier,
  paceTooltip,
  pressure,
  shouldHideWeekly,
  trackLabels,
  zoneFor,
} from './quotaPolicy'
import { burnRate, guardInterval, heldInterval, nextInterval, pushSample } from './smartInterval'

const NOW = 1_000_000_000
const config = { ...DEFAULT_QUOTA_CONFIG.agents.claude, limits: { session: 80, weekly: 90, monthly: 95 } }
const snap = (session: number, weekly?: number, extra: Partial<QuotaSnapshot> = {}): QuotaSnapshot => ({
  windows: [
    { kind: 'session', label: 's', usedPct: session, resetsAt: NOW + 3_600_000 },
    ...(weekly === undefined ? [] : [{ kind: 'weekly' as const, label: 'w', usedPct: weekly, resetsAt: NOW + 86_400_000 }]),
  ],
  fetchedAt: NOW,
  ...extra,
})

describe('zones', () => {
  it('measures zones against the limit, not against 100%', () => {
    expect(zoneFor(30, 80)).toBe('calm')
    expect(zoneFor(40, 80)).toBe('watch')
    expect(zoneFor(56, 80)).toBe('warm')
    expect(zoneFor(64, 80)).toBe('hot')
    expect(zoneFor(72, 80)).toBe('critical')
    expect(zoneFor(80, 80)).toBe('over')
    expect(zoneFor(1, 0)).toBe('over')
  })

  it('escalates the animation with the zone, and can be switched off', () => {
    expect(['calm', 'watch', 'warm', 'hot', 'critical', 'over'].map((zone) => animationFor(zone as never, true)))
      .toEqual(['none', 'none', 'lightning', 'fire', 'burning', 'danger'])
    expect(animationFor('over', false)).toBe('none')
  })

  it('centres the used number in the fill and the danger-zone size in the danger zone', () => {
    expect(trackLabels(60, 80)).toEqual({
      used: { text: '60%', at: 30, fill: 60, inside: true },
      danger: { text: '20%', at: 90, inside: true },
    })
  })

  it('moves the danger zone with the limit and drops it at 100%', () => {
    expect(trackLabels(60, 70).danger).toEqual({ text: '30%', at: 85, inside: true })
    expect(trackLabels(60, 100).danger).toBeNull()
    // 5% or less has no room inside the zone: the number moves after the track.
    expect(trackLabels(60, 94).danger).toEqual({ text: '6%', at: 97, inside: true })
    expect(trackLabels(60, 95).danger).toEqual({ text: '5%', at: 97.5, inside: false })
    expect(trackLabels(60, 99).danger).toEqual({ text: '1%', at: 99.5, inside: false })
  })

  it('puts a short fill\'s number just after it, and clamps over-100 readings', () => {
    expect(trackLabels(5, 80).used).toEqual({ text: '5%', at: 5, fill: 5, inside: false })
    expect(trackLabels(130, 80).used).toMatchObject({ text: '100%', fill: 100 })
  })

  it('colours by used ÷ limit, so a lower limit makes the same usage hotter', () => {
    expect(zoneFor(60, 100)).toBe('watch')
    expect(zoneFor(60, 70)).toBe('hot')
    expect(zoneFor(60, 60)).toBe('over')
  })
})

describe('readings', () => {
  it('trusts only fresh, error-free readings', () => {
    expect(isFresh(snap(10), NOW)).toBe(true)
    expect(isFresh(snap(10, undefined, { error: 'parse_failed' }), NOW)).toBe(false)
    expect(isFresh(snap(10), NOW + 11 * 60_000)).toBe(false)
    expect(isFresh({ windows: [], fetchedAt: NOW }, NOW)).toBe(false)
    expect(isFresh(undefined, NOW)).toBe(false)
  })

  it('finds the breached window that recovers last', () => {
    expect(breachedWindow(snap(50, 50), config, NOW)).toBeNull()
    expect(breachedWindow(snap(85, 50), config, NOW)?.kind).toBe('session')
    expect(breachedWindow(snap(85, 95), config, NOW)?.kind).toBe('weekly')
    const noReset: QuotaSnapshot = { windows: [{ kind: 'session', label: 's', usedPct: 99 }, { kind: 'weekly', label: 'w', usedPct: 99, resetsAt: NOW }], fetchedAt: NOW }
    expect(breachedWindow(noReset, config, NOW)?.kind).toBe('session')
    expect(breachedWindow(snap(99, undefined, { error: 'timeout' }), config, NOW)).toBeNull()
  })

  it('knows when every window is back under its limit', () => {
    expect(allUnderLimit(snap(10, 10), config, NOW)).toBe(true)
    expect(allUnderLimit(snap(10, 90), config, NOW)).toBe(false)
    expect(allUnderLimit(undefined, config, NOW)).toBe(false)
  })

  it('reports pressure as the highest used-to-limit ratio', () => {
    expect(pressure(snap(40, 81), config)).toBeCloseTo(0.9)
    expect(pressure(undefined, config)).toBe(0)
  })

  it('formats countdowns', () => {
    expect(formatCountdown(undefined, NOW)).toBe('')
    expect(formatCountdown(NOW - 1, NOW)).toBe('')
    expect(formatCountdown(NOW + 30_000, NOW)).toBe('30s')
    expect(formatCountdown(NOW + 12 * 60_000, NOW)).toBe('12m')
    expect(formatCountdown(NOW + 65 * 60_000, NOW)).toBe('1h 05m')
    expect(formatCountdown(NOW + 50 * 3_600_000, NOW)).toBe('2d 2h')
  })
})

describe('friendly reset text', () => {
  it('formats a same-day reset as the plain countdown', () => {
    const at = NOW + 30 * 60_000
    expect(formatReset(at, NOW)).toBe(formatCountdown(at, NOW))
  })

  it('formats a reset on the next calendar day as "tomorrow HH:MM"', () => {
    const tomorrow = new Date(NOW)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 30, 0, 0)
    const formatted = formatReset(tomorrow.getTime(), NOW)
    expect(formatted).toMatch(/^tomorrow /)
  })

  it('falls back to the day/hour countdown two or more days out', () => {
    const at = NOW + 3 * 24 * 3_600_000
    expect(formatReset(at, NOW)).toBe(formatCountdown(at, NOW))
  })

  it('is empty once the reset has passed', () => {
    expect(formatReset(NOW - 1, NOW)).toBe('')
    expect(formatReset(undefined, NOW)).toBe('')
  })
})

describe('shouldHideWeekly', () => {
  const weekly = (usedPct: number) =>
    ({ kind: 'weekly' as const, label: 'w', usedPct, resetsAt: NOW + 60 * 3_600_000 })

  it('hides a weekly window when usage is below the default threshold (60%)', () => {
    expect(shouldHideWeekly(weekly(10), NOW)).toBe(true)
    expect(shouldHideWeekly(weekly(59), NOW)).toBe(true)
  })

  it('shows it once usage reaches or exceeds the default threshold (>= 60%)', () => {
    expect(shouldHideWeekly(weekly(60), NOW)).toBe(false)
    expect(shouldHideWeekly(weekly(81), NOW)).toBe(false)
  })

  it('respects a custom threshold parameter', () => {
    expect(shouldHideWeekly(weekly(40), NOW, 50)).toBe(true)
    expect(shouldHideWeekly(weekly(50), NOW, 50)).toBe(false)
    expect(shouldHideWeekly(weekly(30), 40)).toBe(true)
    expect(shouldHideWeekly(weekly(45), 40)).toBe(false)
  })

  it('never hides a non-weekly window', () => {
    expect(shouldHideWeekly({ kind: 'session', label: 's', usedPct: 5, resetsAt: NOW + 60 * 3_600_000 }, NOW)).toBe(false)
  })
})

describe('pace', () => {
  const session = (usedPct: number, resetsAt: number) => ({ kind: 'session' as const, label: 's', usedPct, resetsAt })
  const resetsAt = NOW + 4 * 3_600_000 // 1h already elapsed of the 5h window
  const limit = 90

  it('is null before enough of the window has elapsed, or before meaningful usage', () => {
    expect(paceTier(session(50, NOW + 5 * 3_600_000 - 5 * 60_000), limit, NOW)).toBeNull() // 5 min elapsed
    expect(paceTier(session(1, resetsAt), limit, NOW)).toBeNull()
  })

  it('classifies calm, on-track, fast and overshooting pace', () => {
    // 1h elapsed of 5h (20%); usedPct/elapsedFraction/limit gives the projected ratio.
    expect(paceTier(session(10, resetsAt), limit, NOW)).toBe('slow') // projected 50%, ratio 0.56
    expect(paceTier(session(15, resetsAt), limit, NOW)).toBe('onTrack') // projected 75%, ratio 0.83
    expect(paceTier(session(20, resetsAt), limit, NOW)).toBe('fast') // projected 100%, ratio 1.11
    expect(paceTier(session(30, resetsAt), limit, NOW)).toBe('overshooting') // projected 150%, ratio 1.67
  })

  it('is null for a non-session window or one with no reset time', () => {
    expect(paceTier({ kind: 'weekly', label: 'w', usedPct: 50, resetsAt }, limit, NOW)).toBeNull()
    expect(paceTier({ kind: 'session', label: 's', usedPct: 50 }, limit, NOW)).toBeNull()
  })

  it('reports the projected percentage in the tooltip', () => {
    expect(paceTooltip(session(20, resetsAt), limit, NOW)).toBe('Pace: ~100% by reset (limit 90%)')
  })

  it('picks the header art from used ÷ limit: ≤40% cat, ≤70% horse, ≤85% airplane, then sonic', () => {
    const used = (usedPct: number) => ({ kind: 'session' as const, label: 's', usedPct })
    expect(headerLoadingTier(undefined, 100)).toBe('onTrack')
    expect(headerLoadingTier(used(40), 100)).toBe('slow')
    expect(headerLoadingTier(used(41), 100)).toBe('onTrack')
    expect(headerLoadingTier(used(70), 100)).toBe('onTrack')
    expect(headerLoadingTier(used(71), 100)).toBe('fast')
    expect(headerLoadingTier(used(85), 100)).toBe('fast')
    expect(headerLoadingTier(used(86), 100)).toBe('overshooting')
    // Relative to the limit, not to 100%: 45% used of a 90% limit is 50% of it.
    expect(headerLoadingTier(used(45), limit)).toBe('onTrack')
    expect(headerLoadingTier(used(36), limit)).toBe('slow')
    expect(headerLoadingTier(used(80), limit)).toBe('overshooting')
  })

  it('ignores the burn projection: a fast early burn under 40% of the limit is still the cat', () => {
    expect(headerLoadingTier(session(30, resetsAt), limit)).toBe('slow')
  })
})

describe('smart interval', () => {
  const base = { history: [], pressure: 0.2, headroom: 60, busy: false, errorStreak: 0, now: NOW, random: () => 0 }

  it('keeps a short, reset-aware history', () => {
    let history = pushSample([], { at: 1, usedPct: 10 })
    for (let index = 2; index <= 20; index += 1) history = pushSample(history, { at: index, usedPct: 10 + index })
    expect(history).toHaveLength(12)
    expect(pushSample(history, { at: 99, usedPct: 1 })).toEqual([{ at: 99, usedPct: 1 }])
  })

  it('measures burn rate over the last fifteen minutes', () => {
    const history = [0, 1, 2, 3].map((minute) => ({ at: NOW - (3 - minute) * 60_000, usedPct: 10 + minute * 2 }))
    expect(burnRate(history, NOW)).toBeCloseTo(2)
    expect(burnRate([{ at: NOW, usedPct: 1 }], NOW)).toBeNull()
    expect(burnRate([{ at: NOW, usedPct: 1 }, { at: NOW, usedPct: 2 }], NOW)).toBeNull()
    expect(burnRate([{ at: NOW - 3_600_000, usedPct: 1 }, { at: NOW, usedPct: 2 }], NOW)).toBeNull()
  })

  it('polls an idle, low profile rarely', () => {
    expect(nextInterval(base)).toBe(280_000)
    expect(nextInterval({ ...base, random: () => 1 })).toBe(360_000)
  })

  it('tightens the band as pressure rises', () => {
    const busy = { ...base, busy: true }
    expect(nextInterval({ ...busy, pressure: 0.75 })).toBe(55_000)
    expect(nextInterval({ ...busy, pressure: 0.86 })).toBe(25_000)
    expect(nextInterval({ ...busy, pressure: 0.95 })).toBe(10_000)
  })

  it('re-checks quickly after a spike, and before a projected crossing', () => {
    const spike = [{ at: NOW - 60_000, usedPct: 10 }, { at: NOW, usedPct: 20 }]
    expect(nextInterval({ ...base, history: spike, headroom: 1000 })).toBe(20_000)
    const burning = [0, 1, 2].map((minute) => ({ at: NOW - (2 - minute) * 60_000, usedPct: 50 + minute }))
    expect(nextInterval({ ...base, history: burning, headroom: 8 })).toBe(120_000)
    expect(nextInterval({ ...base, history: burning, headroom: 0 })).toBe(10_000)
  })

  it('backs off exponentially after errors', () => {
    expect(nextInterval({ ...base, errorStreak: 1 })).toBe(30_000)
    expect(nextInterval({ ...base, errorStreak: 3 })).toBe(120_000)
    expect(nextInterval({ ...base, errorStreak: 9 })).toBe(300_000)
  })

  it('reads a fully suspended profile slowly but on time for its resume', () => {
    expect(heldInterval(undefined, NOW)).toBe(120_000)
    expect(heldInterval(NOW + 3_600_000, NOW)).toBe(300_000)
    expect(heldInterval(NOW + 90_000, NOW)).toBe(90_000)
    expect(heldInterval(NOW - 1, NOW)).toBe(30_000)
  })

  it('guards on a 15–20 s cadence', () => {
    expect(guardInterval(() => 0)).toBe(15_000)
    expect(guardInterval(() => 1)).toBe(20_000)
    expect(guardInterval()).toBeGreaterThanOrEqual(15_000)
  })
})
