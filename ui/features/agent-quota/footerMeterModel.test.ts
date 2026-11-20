import { describe, expect, it } from 'vitest'

import type { QuotaState } from './quotaStore'

import { DEFAULT_QUOTA_CONFIG } from './quotaConfig'
import { footerMeters, footerRisk } from './footerMeterModel'

const NOW = Date.UTC(2026, 10, 19, 3, 0)

function state(windows: Array<{ kind: 'session' | 'weekly' | 'monthly'; usedPct: number; resetsAt?: number }> | null, enabled = true): Pick<QuotaState, 'config' | 'terminals' | 'profiles' | 'overrides'> {
  return {
    config: { ...DEFAULT_QUOTA_CONFIG, enabled },
    terminals: { t1: { sessionId: 't1', agent: 'claude', pid: 1, startTime: 0, profileDir: 'C:/p', profileName: 'p', subAgentCount: 0, launcher: null, instanceKey: 'i1', profileKey: 'k' } },
    profiles: {
      k: {
        key: 'k', agent: 'claude', profileName: 'p', profileDir: 'C:/p', launcher: null, history: [], errorStreak: 0,
        nextFetchAt: 0, fetching: false, wake: {}, waking: false,
        ...(windows ? { lastGood: { fetchedAt: NOW, windows: windows.map((window) => ({ label: window.kind, ...window })) } } : {}),
      },
    },
    overrides: {},
  }
}

describe('footerMeters', () => {
  it('draws the 5-hour and weekly quota, then the context, coloured against their limits', () => {
    const meters = footerMeters(state([{ kind: 'weekly', usedPct: 94.6 }, { kind: 'session', usedPct: 41.2, resetsAt: NOW + 90 * 60_000 }]), 't1', 72.4, NOW)
    expect(meters.map(({ key, label, pct }) => [key, label, pct])).toEqual([
      ['session', '5h', 41],
      ['weekly', 'wk', 95],
      ['context', 'ctx', 72],
    ])
    expect(meters[0].zone).toBe('calm')
    expect(meters[1].zone).toBe('critical')
    expect(meters[2].zone).toBe('warm')
    expect(meters[0].title).toMatch(/^5-hour quota: 41% used \(limit \d+%\), resets /)
    expect(meters[2].title).toBe('Context window: 72% used')
  })

  it('leaves out what is not known and never draws a monthly window', () => {
    expect(footerMeters(state([{ kind: 'monthly', usedPct: 10 }]), 't1', null, NOW)).toEqual([])
    expect(footerMeters(state(null), 't1', null, NOW)).toEqual([])
    expect(footerMeters(state([{ kind: 'session', usedPct: 10 }]), 'other', null, NOW)).toEqual([])
    expect(footerMeters(state(null), 'other', 5, NOW).map((meter) => meter.key)).toEqual(['context'])
  })

  it('shows no quota while Agent Quota is off, the context still', () => {
    const meters = footerMeters(state([{ kind: 'session', usedPct: 10 }], false), 't1', 130, NOW)
    expect(meters.map(({ key, pct }) => [key, pct])).toEqual([['context', 100]])
  })
})

describe('footerRisk', () => {
  const withRisk = (risk: 'danger' | 'idle', sessions: number, headless: number, enabled = true) => {
    const base = state(null, enabled)
    return { ...base, profiles: { k: { ...base.profiles.k, risk, activity: { sessions, headless } } } }
  }

  it('warns while other sessions spend the same quota, and names the headless ones', () => {
    expect(footerRisk(withRisk('danger', 3, 0), 't1')).toEqual({
      text: '×3',
      title: '3 Claude sessions on this machine use the p profile: its quota is read every few minutes.',
    })
    expect(footerRisk(withRisk('danger', 1, 1), 't1')?.title).toBe(
      '1 Claude session on this machine uses the p profile, 1 of them headless (claude -p, which the status line never sees): its quota is read every few minutes.',
    )
  })

  it('says nothing for a calm profile, another pane or with the feature off', () => {
    expect(footerRisk(withRisk('idle', 1, 0), 't1')).toBeNull()
    expect(footerRisk(withRisk('danger', 2, 0), 'other')).toBeNull()
    expect(footerRisk(withRisk('danger', 2, 0, false), 't1')).toBeNull()
  })
})
