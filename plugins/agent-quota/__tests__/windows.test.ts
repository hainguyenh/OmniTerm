import { describe, expect, it } from 'vitest'

import { asNumber, classifyWindowSeconds, normalizeRateWindow, toEpochMs, worstPerKind } from '../src/windows'

describe('window helpers', () => {
  it('classifies windows by length', () => {
    expect(classifyWindowSeconds(5 * 3600)).toBe('session')
    expect(classifyWindowSeconds(7 * 86400)).toBe('weekly')
    expect(classifyWindowSeconds(30 * 86400)).toBe('monthly')
    expect(classifyWindowSeconds(3600)).toBeNull()
    expect(classifyWindowSeconds(null)).toBeNull()
    expect(classifyWindowSeconds(0)).toBeNull()
  })

  it('reads numbers and times defensively', () => {
    expect(asNumber('4.5')).toBe(4.5)
    expect(asNumber(' ')).toBeNull()
    expect(asNumber('x')).toBeNull()
    expect(asNumber(Infinity)).toBeNull()
    expect(toEpochMs(1790321877)).toBe(1790321877000)
    expect(toEpochMs(1790321877000)).toBe(1790321877000)
    expect(toEpochMs('2026-09-25T00:00:00Z')).toBe(Date.UTC(2026, 8, 25))
    expect(toEpochMs('never')).toBeUndefined()
    expect(toEpochMs({})).toBeUndefined()
  })

  it('normalises a rate window, falling back to its position', () => {
    expect(normalizeRateWindow({ usedPercent: 150, resetsAt: '2026-09-25T00:00:00Z' }, 'session')).toEqual({
      kind: 'session', label: '5-hour session', usedPct: 100, resetsAt: Date.UTC(2026, 8, 25),
    })
    expect(normalizeRateWindow({ used_percent: 5, window_minutes: 1 }, null)).toBeNull()
    expect(normalizeRateWindow({ window_minutes: 300 }, 'session')).toBeNull()
    expect(normalizeRateWindow([], 'session')).toBeNull()
  })

  it('keeps the fullest window of each kind, in order', () => {
    expect(worstPerKind([
      { kind: 'weekly', label: 'a', usedPct: 10 },
      { kind: 'session', label: 'b', usedPct: 5 },
      { kind: 'weekly', label: 'c', usedPct: 30 },
    ]).map((window) => window.label)).toEqual(['b', 'c'])
  })
})
