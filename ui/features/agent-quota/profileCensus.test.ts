import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { CensusView, ProfileCensus } from './profileCensus'
import type { ProfileQuota, TerminalAgent } from './quotaStore'

import { activityOf, CENSUS_TTL_MS, CensusWatcher, DANGER_RECORD_MS, parseProfileCensus, planUsageRead, usageRisk } from './profileCensus'
import { FRESH_MS } from './quotaPolicy'
import { resetQuotaStore, updateQuota } from './quotaStore'

const WORK = 'C:\\Users\\me\\.claude-work'

const profile = (overrides: Partial<ProfileQuota> = {}): ProfileQuota => ({
  key: 'claude:c:\\users\\me\\.claude-work', agent: 'claude', profileName: 'claude-work', profileDir: WORK, launcher: null,
  history: [], errorStreak: 0, nextFetchAt: 0, fetching: false, wake: {}, waking: false, ...overrides,
})

const terminal = (sessionId: string): TerminalAgent => ({
  sessionId, agent: 'claude', pid: 1, startTime: 0, profileDir: WORK, profileName: 'claude-work', subAgentCount: 0, launcher: null,
  instanceKey: `${sessionId}:1:0`, profileKey: profile().key,
})

const reading = { lastGood: { windows: [{ kind: 'session' as const, label: '5h', usedPct: 10 }], fetchedAt: 0 } }

beforeEach(() => resetQuotaStore())

describe('the census payload', () => {
  it('keeps well-formed Claude rows only', () => {
    expect(parseProfileCensus([
      { agent: 'claude', profileDir: WORK, sessions: 2, headless: 1 },
      { agent: 'claude', profileDir: null, sessions: 1, headless: 0 },
      { agent: 'codex', profileDir: WORK, sessions: 1, headless: 0 },
      { agent: 'claude', profileDir: WORK, sessions: 1, headless: 2 },
      { agent: 'claude', profileDir: 7, sessions: 1, headless: 0 },
      { agent: 'claude', profileDir: WORK, sessions: -1, headless: 0 },
      null,
    ])).toEqual([
      { profileDir: WORK, sessions: 2, headless: 1 },
      { profileDir: null, sessions: 1, headless: 0 },
    ])
    expect(parseProfileCensus('nope')).toEqual([])
  })
})

describe('which sessions spend a profile', () => {
  const NOW = 1_000_000
  const view = (panesAt: Record<string, number> = {}, at = NOW): CensusView => ({
    at,
    rows: [
      { profileDir: 'c:/users/me/.claude-work/', sessions: 3, headless: 1 },
      { profileDir: 'C:\\Users\\me\\.claude', sessions: 5, headless: 0 },
      { profileDir: null, sessions: 4, headless: 4 },
    ],
    panesAt,
  })

  it('matches the profile folder however it is spelt, and never another profile', () => {
    expect(activityOf(profile(), view(), 0, NOW)).toEqual({ sessions: 3, headless: 1 })
    expect(activityOf(profile({ profileDir: 'C:\\Users\\me\\.claude-other' }), view(), 1, NOW)).toEqual({ sessions: 1, headless: 0 })
  })

  it('follows the panes live and keeps the sessions the census saw outside them', () => {
    // The census saw 3: 2 in panes then, 1 outside. One pane closed since; the outside one stays.
    const twoPanes = view({ 'c:\\users\\me\\.claude-work': 2 })
    expect(activityOf(profile(), twoPanes, 1, NOW + 60_000)).toEqual({ sessions: 2, headless: 1 })
    expect(activityOf(profile(), twoPanes, 0, NOW + 60_000)).toEqual({ sessions: 1, headless: 1 })
  })

  it('knows nothing without a census, with one too old, or without a folder', () => {
    expect(activityOf(profile(), null, 1, NOW)).toBeNull()
    expect(activityOf(profile(), view(), 1, NOW + CENSUS_TTL_MS + 1)).toBeNull()
    expect(activityOf(profile({ profileDir: null }), view(), 1, NOW)).toBeNull()
  })
})

describe('how closely a profile is read', () => {
  it('is in danger with more than one session or any headless run, even while its pane is idle', () => {
    expect(usageRisk({ sessions: 2, headless: 0 }, false)).toBe('danger')
    expect(usageRisk({ sessions: 1, headless: 1 }, false)).toBe('danger')
    expect(usageRisk({ sessions: 1, headless: 0 }, true)).toBe('active')
    expect(usageRisk({ sessions: 1, headless: 0 }, false)).toBe('idle')
    expect(usageRisk(null, true)).toBe('unknown')
  })

  it('reads nothing for one idle session once there is a reading, and asks for younger records the riskier it gets', () => {
    const one = { sessions: 1, headless: 0 }
    expect(planUsageRead(profile(reading), one, false)).toMatchObject({ risk: 'idle', read: false })
    expect(planUsageRead(profile(), one, false)).toMatchObject({ risk: 'idle', read: true, request: {} })
    expect(planUsageRead(profile(reading), one, true)).toMatchObject({ read: true, request: { maxRecordAgeMs: FRESH_MS } })
    expect(planUsageRead(profile(reading), { sessions: 2, headless: 0 }, false))
      .toMatchObject({ risk: 'danger', read: true, request: { maxRecordAgeMs: DANGER_RECORD_MS } })
    expect(planUsageRead(profile(reading), null, false)).toMatchObject({ risk: 'unknown', read: true, request: {} })
  })
})

describe('CensusWatcher', () => {
  const api = (census: AgentQuotaAPI['census']) => ({ census }) as unknown as AgentQuotaAPI

  it('takes the census when a Claude agent is new, and once more for agents that start while it runs', async () => {
    let answer: (rows: ProfileCensus[]) => void = () => {}
    const census = vi.fn(() => new Promise<ProfileCensus[]>((resolve) => { answer = resolve }))
    const watcher = new CensusWatcher(api(census))
    const work: Promise<void>[] = []
    expect(watcher.plan(profile(reading), [terminal('s1')], {}, 0).risk).toBe('unknown')

    watcher.noteAgents(0, [terminal('s1')], (job) => work.push(job))
    watcher.noteAgents(2, [terminal('s1')], (job) => work.push(job))
    watcher.noteAgents(5, [terminal('s1'), terminal('s2')], (job) => work.push(job))
    expect(census).toHaveBeenCalledTimes(1)
    answer([{ profileDir: WORK, sessions: 1, headless: 0 }])
    await work[0]
    expect(census).toHaveBeenCalledTimes(2)
    answer([{ profileDir: WORK, sessions: 3, headless: 0 }])
    await Promise.all(work)
    // Three sessions: the two panes and one outside them.
    expect(watcher.plan(profile(reading), [terminal('s1'), terminal('s2')], {}, 10)).toMatchObject({ risk: 'danger', activity: { sessions: 3 } })
    expect(watcher.plan(profile(reading), [], {}, 10)).toMatchObject({ risk: 'idle', activity: { sessions: 1 } })
  })

  it('counts a guarded or busy pane as working, forgets a failed census, and leaves other agents alone', async () => {
    const census = vi.fn(async (): Promise<ProfileCensus[]> => [{ profileDir: WORK, sessions: 1, headless: 0 }])
    const watcher = new CensusWatcher(api(census))
    const work: Promise<void>[] = []
    watcher.noteAgents(0, [terminal('s1')], (job) => work.push(job))
    await Promise.all(work)
    expect(watcher.plan(profile(reading), [terminal('s1')], {}, 0).risk).toBe('idle')
    expect(watcher.plan(profile(reading), [terminal('s1')], { s1: true }, 0).risk).toBe('active')
    updateQuota((state) => ({ ...state, guards: { 's1:1:0': { phase: 'guarding', lastAttemptAt: 0, risingCount: 0 } } }))
    expect(watcher.plan(profile(reading), [terminal('s1')], {}, 0).risk).toBe('active')
    expect(watcher.plan(profile({ ...reading, agent: 'agy' }), [terminal('s1')], {}, 0)).toMatchObject({ risk: 'unknown', read: true })

    census.mockRejectedValueOnce(new Error('gone'))
    watcher.noteAgents(1, [terminal('s3')], (job) => work.push(job))
    await Promise.all(work)
    expect(watcher.plan(profile(reading), [terminal('s3')], {}, 1).risk).toBe('unknown')
  })
})
