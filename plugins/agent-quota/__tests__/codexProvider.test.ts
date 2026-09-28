import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { fetchCodexUsage, parseRateLimits, readLatestRollout } from '../src/providers/codex'

import { fakeDeps, HOME, NOW } from './fakeDeps'

const CODEX = path.join(HOME, '.codex')
const RESET_5H = Math.floor(NOW / 1000) + 3600
const RESET_7D = Math.floor(NOW / 1000) + 5 * 86400

// Shape copied from a real rollout (event_msg / token_count).
const rateLimits = (primary: number, secondary: number) => ({
  limit_id: 'codex',
  primary: { used_percent: primary, window_minutes: 300, resets_at: RESET_5H },
  secondary: { used_percent: secondary, window_minutes: 10080, resets_at: RESET_7D },
  credits: { has_credits: false, unlimited: false, balance: null },
  plan_type: 'team',
})

const event = (at: number, limits: unknown) =>
  JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type: 'token_count', rate_limits: limits } })

const rolloutFile = (day: string, name: string) => path.join(CODEX, 'sessions', '2026', '09', day, name)

describe('readLatestRollout', () => {
  it('reads the last rate_limits event of the newest day, skipping a cut first line', async () => {
    const files = {
      [rolloutFile('24', 'rollout-a.jsonl')]: event(NOW - 86_400_000, rateLimits(1, 2)),
      [rolloutFile('25', 'rollout-b.jsonl')]: ['{"cut": tr', event(NOW - 5000, rateLimits(31, 95)), '{"type":"other"}', ''].join('\n'),
      [rolloutFile('25', 'notes.txt')]: 'ignored',
    }
    const reading = await readLatestRollout(CODEX, fakeDeps(files))
    expect(reading).toEqual({
      at: NOW - 5000,
      windows: [
        { kind: 'session', label: '5-hour session', usedPct: 31, resetsAt: RESET_5H * 1000 },
        { kind: 'weekly', label: 'Weekly', usedPct: 95, resetsAt: RESET_7D * 1000 },
      ],
    })
  })

  it('returns null without sessions or readable events', async () => {
    expect(await readLatestRollout(CODEX, fakeDeps())).toBeNull()
    const undated = JSON.stringify({ timestamp: 'garbage', payload: { rate_limits: rateLimits(1, 1) } })
    const junk = { [rolloutFile('25', 'rollout-a.jsonl')]: '{"rate_limits": broken\n' + undated }
    expect(await readLatestRollout(CODEX, fakeDeps(junk))).toBeNull()
  })
})

describe('fetchCodexUsage', () => {
  it('reads the newest rollout, with credits, and never needs a token', async () => {
    const limits = { ...rateLimits(40, 50), credits: { has_credits: true, unlimited: false, balance: '4.5' } }
    const deps = fakeDeps({ [rolloutFile('25', 'rollout-b.jsonl')]: event(NOW - 1000, limits) })
    const snapshot = await fetchCodexUsage(null, deps)
    expect(snapshot).toMatchObject({ source: 'rollout', windows: [{ usedPct: 40 }, { usedPct: 50 }], credits: { balance: 4.5, unlimited: false } })
  })

  it('keeps an old rollout, dropping windows whose reset has passed', async () => {
    const stale = rateLimits(70, 80)
    stale.primary.resets_at = Math.floor(NOW / 1000) - 60
    const files = { [rolloutFile('25', 'rollout-b.jsonl')]: event(NOW - 600_000, stale) }
    const snapshot = await fetchCodexUsage(CODEX, fakeDeps(files))
    expect(snapshot).toMatchObject({ source: 'rollout', windows: [{ kind: 'weekly', usedPct: 80 }] })
  })

  it('says usage appears after the first reply when nothing current is recorded', async () => {
    expect(await fetchCodexUsage(CODEX, fakeDeps())).toMatchObject({ error: 'unsupported', message: 'Codex usage appears after its first reply.' })
    const spent = rateLimits(1, 1)
    spent.primary.resets_at = 1
    spent.secondary.resets_at = 1
    const files = { [rolloutFile('25', 'rollout-b.jsonl')]: event(NOW - 600_000, spent) }
    expect(await fetchCodexUsage(CODEX, fakeDeps(files))).toMatchObject({ error: 'unsupported' })
  })
})

describe('parseRateLimits', () => {
  it('classifies by length and carries credits', () => {
    expect(parseRateLimits({
      primary: { used_percent: 5 },
      monthly_window: { used_percent: 9, limit_window_seconds: 30 * 86400 },
      credits: { has_credits: true, unlimited: true, balance: null },
    })).toEqual({
      windows: [
        { kind: 'session', label: '5-hour session', usedPct: 5 },
        { kind: 'monthly', label: 'Monthly', usedPct: 9 },
      ],
      credits: { balance: null, unlimited: true },
    })
    expect(parseRateLimits({})).toBeNull()
    expect(parseRateLimits('nope')).toBeNull()
  })
})
