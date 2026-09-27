import { describe, expect, it } from 'vitest'

import { parseResetText, zonedToEpoch } from '../src/parseReset'

const NOW = Date.UTC(2026, 8, 25, 3, 0)
const local = (days: number, hour: number, minute = 0) => {
  const today = new Date(NOW)
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hour, minute).getTime()
}

describe('parseResetText', () => {
  it('honours a bracketed IANA zone', () => {
    expect(parseResetText('Sep 25, 12:59pm (Asia/Ho_Chi_Minh)', NOW)).toBe(Date.UTC(2026, 8, 25, 5, 59))
    expect(parseResetText('resets 25 Sep 1pm (UTC)', NOW)).toBe(Date.UTC(2026, 8, 25, 13, 0))
    expect(parseResetText('tomorrow, 2:50am (Asia/Ho_Chi_Minh)', NOW)).toBe(Date.UTC(2026, 8, 25, 19, 50))
    expect(parseResetText('today 6pm (UTC)', NOW)).toBe(Date.UTC(2026, 8, 25, 18, 0))
  })

  it('falls back to local time for a missing or unknown zone', () => {
    expect(parseResetText('tomorrow, 14:30', NOW)).toBe(local(1, 14, 30))
    expect(parseResetText('Resets at 11:59pm (Not/AZone)', NOW)).toBe(local(0, 23, 59) < NOW - 60_000 ? local(1, 23, 59) : local(0, 23, 59))
    expect(parseResetText('Sep 26', NOW)).toBe(new Date(2026, 8, 26).getTime())
  })

  it('handles midnight and noon in 12-hour form', () => {
    expect(parseResetText('Sep 26, 12am (UTC)', NOW)).toBe(Date.UTC(2026, 8, 26, 0, 0))
    expect(parseResetText('Sep 26, 12:00 p.m. (UTC)', NOW)).toBe(Date.UTC(2026, 8, 26, 12, 0))
  })

  it('moves a January date seen in December into next year', () => {
    const december = Date.UTC(2026, 11, 30, 12)
    expect(parseResetText('Jan 2, 9am (UTC)', december)).toBe(Date.UTC(2027, 0, 2, 9))
  })

  it('reads relative, ISO and epoch forms', () => {
    expect(parseResetText('in 1d 2h 5m', NOW)).toBe(NOW + ((24 + 2) * 60 + 5) * 60_000)
    expect(parseResetText('in 45 minutes', NOW)).toBe(NOW + 45 * 60_000)
    expect(parseResetText('2026-09-25T05:59:00Z', NOW)).toBe(Date.UTC(2026, 8, 25, 5, 59))
    expect(parseResetText('1790321877', NOW)).toBe(1790321877000)
    expect(parseResetText('1790321877000', NOW)).toBe(1790321877000)
  })

  it('returns undefined for anything that is not a time', () => {
    for (const text of ['', 'resets', 'soon', '13pm', '25:00', '9:75', 'Foo 12', '2026-99-99Tnope', 'in 0m', '40 of 32']) {
      expect(parseResetText(text, NOW), text).toBeUndefined()
    }
  })

  it('defaults the clock to now', () => {
    expect(parseResetText('in 1h')).toBeGreaterThan(Date.now())
  })
})

describe('zonedToEpoch', () => {
  it('resolves wall-clock time across a DST change', () => {
    // 2026-11-01 01:30 in New York happens twice; either reading is an hour apart at most.
    const epoch = zonedToEpoch({ year: 2026, month: 10, day: 1 }, 1, 30, 'America/New_York')
    expect([Date.UTC(2026, 10, 1, 5, 30), Date.UTC(2026, 10, 1, 6, 30)]).toContain(epoch)
    expect(zonedToEpoch({ year: 2026, month: 0, day: 15 }, 9, 0, 'Europe/Berlin')).toBe(Date.UTC(2026, 0, 15, 8, 0))
  })
})
