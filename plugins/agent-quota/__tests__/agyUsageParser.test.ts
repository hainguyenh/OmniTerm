import { describe, expect, it } from 'vitest'

import { normalizeUsageText, parseAgyUsage } from '../src/agyUsageParser'

const USER_FIXTURE = `Quota:
Gemini Models          Weekly Limit Remaining     55%   2026-10-02T08:47:03Z
Gemini Models          Five Hour Limit Remaining  82%   2026-09-28T07:11:00Z
Claude and GPT models  Weekly Limit Remaining     100%  2026-10-05T03:34:51Z
Claude and GPT models  Five Hour Limit Remaining  100%  2026-09-28T08:34:51Z`

const TAB_FIXTURE = `Gemini Models\tWeekly Limit Remaining\t55%\t2026-10-02T08:47:03Z
Gemini Models\tFive Hour Limit Remaining\t80%\t2026-09-28T07:11:00Z
Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-05T03:42:50Z
Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-09-28T08:42:50Z`

describe('normalizeUsageText', () => {
  it('strips ANSI color codes and carriage returns', () => {
    const raw = '\x1b[32mGemini Models\x1b[0m\tWeekly Limit Remaining\t55%\r\n'
    expect(normalizeUsageText(raw)).toEqual(['Gemini Models\tWeekly Limit Remaining\t55%'])
  })
})

describe('parseAgyUsage', () => {
  it('parses the multi-model quota output from user fixture', () => {
    const now = Date.UTC(2026, 8, 28, 3, 30)
    const result = parseAgyUsage(USER_FIXTURE, now)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.windows).toHaveLength(2)

    const session = result.windows.find((w) => w.kind === 'session')
    expect(session).toBeDefined()
    expect(session?.kind).toBe('session')
    // Gemini: 82% remaining -> 18% used. Claude & GPT: 100% remaining -> 0% used.
    expect(session?.usedPct).toBe(18)
    expect(session?.resetsAt).toBe(Date.parse('2026-09-28T07:11:00Z'))
    expect(session?.breakdown).toEqual([
      { label: 'Gemini Models', usedPct: 18 },
      { label: 'Claude and GPT models', usedPct: 0 },
    ])

    const weekly = result.windows.find((w) => w.kind === 'weekly')
    expect(weekly).toBeDefined()
    expect(weekly?.kind).toBe('weekly')
    // Gemini: 55% remaining -> 45% used. Claude & GPT: 100% remaining -> 0% used.
    expect(weekly?.usedPct).toBe(45)
    expect(weekly?.resetsAt).toBe(Date.parse('2026-10-02T08:47:03Z'))
    expect(weekly?.breakdown).toEqual([
      { label: 'Gemini Models', usedPct: 45 },
      { label: 'Claude and GPT models', usedPct: 0 },
    ])
  })

  it('parses tab-delimited agy usage output', () => {
    const now = Date.UTC(2026, 8, 28, 3, 30)
    const result = parseAgyUsage(TAB_FIXTURE, now)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const session = result.windows.find((w) => w.kind === 'session')
    expect(session?.usedPct).toBe(20) // 100 - 80
    expect(session?.resetsAt).toBe(Date.parse('2026-09-28T07:11:00Z'))

    const weekly = result.windows.find((w) => w.kind === 'weekly')
    expect(weekly?.usedPct).toBe(45) // 100 - 55
    expect(weekly?.resetsAt).toBe(Date.parse('2026-10-02T08:47:03Z'))
  })

  it('omits breakdown when only a single model exists', () => {
    const single = 'Gemini Models  Five Hour Limit Remaining  75%  2026-09-28T07:11:00Z'
    const result = parseAgyUsage(single)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.windows).toHaveLength(1)
    expect(result.windows[0]).toMatchObject({
      kind: 'session',
      usedPct: 25,
      resetsAt: Date.parse('2026-09-28T07:11:00Z'),
    })
    expect(result.windows[0].breakdown).toBeUndefined()
  })

  it('handles explicit "used" percent lines', () => {
    const usedLine = 'Gemini Models  Five Hour Limit Used  35%  2026-09-28T07:11:00Z'
    const result = parseAgyUsage(usedLine)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.windows[0].usedPct).toBe(35)
  })

  it('detects unauthenticated or not-signed-in messages', () => {
    expect(parseAgyUsage('Please run /login to authenticate')).toMatchObject({
      ok: false,
      error: 'not_signed_in',
    })
    expect(parseAgyUsage('User not logged in')).toMatchObject({
      ok: false,
      error: 'not_signed_in',
    })
  })

  it('rejects output with no quota windows', () => {
    expect(parseAgyUsage('Hello world')).toMatchObject({
      ok: false,
      error: 'parse_failed',
    })
    expect(parseAgyUsage('')).toMatchObject({
      ok: false,
      error: 'parse_failed',
    })
    expect(parseAgyUsage('Gemini Models Daily Limit Remaining 50% 2026-09-28T07:11:00Z')).toMatchObject({
      ok: false,
      error: 'parse_failed',
    })
    expect(parseAgyUsage('Gemini Models Five Hour Limit Remaining 150% 2026-09-28T07:11:00Z')).toMatchObject({
      ok: false,
      error: 'parse_failed',
    })
  })

  it('parses monthly windows, non-ISO reset text, and default model name', () => {
    const monthly = 'Gemini Models Monthly Limit Remaining 50% 2026-10-30T00:00:00Z'
    const resultMonthly = parseAgyUsage(monthly)
    expect(resultMonthly.ok).toBe(true)
    if (resultMonthly.ok) {
      expect(resultMonthly.windows[0]).toMatchObject({
        kind: 'monthly',
        usedPct: 50,
      })
    }

    const relative = 'Five Hour Limit Remaining 80% resets in 2 hours'
    const resultRelative = parseAgyUsage(relative, Date.UTC(2026, 8, 28, 5, 0))
    expect(resultRelative.ok).toBe(true)
    if (resultRelative.ok) {
      expect(resultRelative.windows[0]).toMatchObject({
        kind: 'session',
        usedPct: 20,
      })
      expect(resultRelative.windows[0].resetsAt).toBe(Date.UTC(2026, 8, 28, 7, 0))
    }

    const noReset = 'Five Hour Limit Remaining 80%'
    const resultNoReset = parseAgyUsage(noReset)
    expect(resultNoReset.ok).toBe(true)
    if (resultNoReset.ok) {
      expect(resultNoReset.windows[0].resetsAt).toBeUndefined()
    }

    const invalidIso = 'Five Hour Limit Remaining 80% 0000-00-00T00:00:00Z'
    const resultInvalidIso = parseAgyUsage(invalidIso)
    expect(resultInvalidIso.ok).toBe(true)
    if (resultInvalidIso.ok) {
      expect(resultInvalidIso.windows[0].resetsAt).toBeUndefined()
    }
  })

  it('synthesizes a 100% full 5h window when agy output only reports weekly limit', () => {
    const weeklyOnly = 'Gemini Models Weekly Limit Remaining 49% 2026-10-02T08:47:03Z'
    const result = parseAgyUsage(weeklyOnly)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.windows).toHaveLength(2)
    const session = result.windows.find((w) => w.kind === 'session')
    expect(session).toEqual({
      kind: 'session',
      label: 'Session (5h)',
      usedPct: 0,
    })
    const weekly = result.windows.find((w) => w.kind === 'weekly')
    expect(weekly?.usedPct).toBe(51)
  })
})
