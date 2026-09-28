import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeUsageText, parseClaudeUsage } from '../src/claudeUsageParser'

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, 'fixtures', 'claude-usage', name), 'utf8')

// 2026-09-25 10:00 in Ho Chi Minh City (UTC+7), 2026-09-24 20:00 in Los Angeles (PDT).
const NOW = Date.UTC(2026, 8, 25, 3, 0)

function windows(name: string) {
  const parsed = parseClaudeUsage(fixture(name), NOW)
  if (!parsed.ok) throw new Error(`${name}: ${parsed.message}`)
  return parsed.windows
}

describe('parseClaudeUsage', () => {
  it('reads the current CLI format and ignores the percentages in its prose', () => {
    expect(windows('current-2026-09.txt')).toEqual([
      { kind: 'session', label: 'Current session', usedPct: 46, resetsAt: Date.UTC(2026, 8, 25, 5, 59) },
      { kind: 'weekly', label: 'Current week (all models)', usedPct: 87, resetsAt: Date.UTC(2026, 8, 25, 15, 59) },
    ])
  })

  it('reads the inline format older releases printed, rolling a past bare time to tomorrow', () => {
    expect(windows('legacy-inline.txt')).toEqual([
      { kind: 'session', label: 'Current session', usedPct: 45, resetsAt: Date.UTC(2026, 8, 25, 19, 50) },
      { kind: 'weekly', label: 'Current week (all models)', usedPct: 12, resetsAt: Date.UTC(2026, 8, 30, 2, 0) },
    ])
  })

  it('reads the bar panel with ANSI colour and per-model weekly lines', () => {
    const [session, weekly] = windows('ansi-panel.txt')
    expect(session).toEqual({ kind: 'session', label: 'Current session', usedPct: 19, resetsAt: Date.UTC(2026, 8, 25, 22, 0) })
    expect(weekly).toMatchObject({ kind: 'weekly', label: 'Current week (Opus 4)', usedPct: 33.5, resetsAt: Date.UTC(2026, 9, 1, 16, 0) })
    expect(weekly.breakdown).toEqual([
      { label: 'Current week (all models)', usedPct: 8 },
      { label: 'Current week (Opus 4)', usedPct: 33.5 },
    ])
  })

  it('converts remaining to used, accepts decimal commas, CRLF, bullets and a monthly line', () => {
    const [session, weekly, monthly] = windows('remaining-decimal.txt')
    expect(session).toMatchObject({ kind: 'session', label: '5-hour limit', usedPct: 87.5, resetsAt: NOW + (2 * 60 + 13) * 60_000 })
    const local = new Date(NOW)
    expect(weekly).toMatchObject({
      kind: 'weekly',
      usedPct: 40.5,
      resetsAt: new Date(local.getFullYear(), local.getMonth(), local.getDate() + 1, 14, 30).getTime(),
    })
    expect(monthly).toEqual({ kind: 'monthly', label: 'Monthly limit', usedPct: 3 })
  })

  it('reports a signed-out profile distinctly', () => {
    expect(parseClaudeUsage(fixture('not-signed-in.txt'), NOW)).toMatchObject({ ok: false, error: 'not_signed_in' })
  })

  it('never reads a model reply or prose as usage', () => {
    expect(parseClaudeUsage(fixture('model-reply.txt'), NOW)).toMatchObject({ ok: false, error: 'parse_failed' })
    expect(parseClaudeUsage(fixture('prose-only.txt'), NOW)).toMatchObject({ ok: false, error: 'parse_failed' })
    expect(parseClaudeUsage('', NOW)).toMatchObject({ ok: false, error: 'parse_failed' })
  })

  it('requires the session window and rejects impossible values', () => {
    expect(parseClaudeUsage('Current week: 20% used', NOW)).toMatchObject({ ok: false, error: 'parse_failed' })
    expect(parseClaudeUsage('Current session: 150% used', NOW)).toMatchObject({ ok: false })
    expect(parseClaudeUsage('Session history\nCurrent session: 5% used', NOW)).toMatchObject({
      ok: true,
      windows: [{ kind: 'session', usedPct: 5 }],
    })
  })

  it('drops a reset date too far ahead to be real', () => {
    expect(parseClaudeUsage('Current session: 5% used · resets 2026-12-25T00:00:00Z', NOW)).toEqual({
      ok: true,
      windows: [{ kind: 'session', label: 'Current session', usedPct: 5 }],
    })
  })

  it('stops reading below a label at the next label', () => {
    const parsed = parseClaudeUsage('Current session\nCurrent week: 9% used\n', NOW)
    expect(parsed).toMatchObject({ ok: false, error: 'parse_failed' })
  })
})

describe('normalizeUsageText', () => {
  it('strips escapes, glyphs and list markers and unifies separators', () => {
    expect(normalizeUsageText('\x1b]0;title\x07\x1b[1m> Current session\x1b[0m ▓▓ | 3% used\r')).toEqual([
      'Current session · 3% used',
    ])
  })
})
