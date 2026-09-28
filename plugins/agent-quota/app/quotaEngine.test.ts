import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuotaSnapshot } from '../src/types'
import type { AgentQuotaAPI, SessionAgent } from './agentQuotaAPI'

import { DEFAULT_QUOTA_CONFIG, type QuotaConfig } from './quotaConfig'
import { QuotaEngine } from './quotaEngine'
import { getQuotaState, resetQuotaStore, setOverride, updateQuota } from './quotaStore'

const T0 = Date.UTC(2026, 8, 25, 3, 0)
const RESET = T0 + 3_600_000

const agent = (overrides: Partial<SessionAgent> = {}): SessionAgent => ({
  sessionId: 's1', agent: 'claude', pid: 10, startTime: 100, profileDir: 'C:\\p\\work', profileName: 'work',
  subAgentCount: 0, launcher: null, ...overrides,
})

const reading = (session: number, weekly = 20, at = T0): QuotaSnapshot => ({
  windows: [
    { kind: 'session', label: 's', usedPct: session, resetsAt: RESET },
    { kind: 'weekly', label: 'w', usedPct: weekly },
  ],
  fetchedAt: at,
})

function setup(config: QuotaConfig = DEFAULT_QUOTA_CONFIG) {
  let now = T0
  let rows: SessionAgent[] = [agent()]
  let usage: QuotaSnapshot = reading(40)
  const api = {
    info: vi.fn(async () => true),
    detect: vi.fn(async () => rows),
    suspend: vi.fn(async (_sessionId: string, pid: number, startTime: number) => ({ frozen: [{ pid, startTime, image: 'claude.exe' }], newlyFrozen: 1, errors: [] as string[] })),
    resume: vi.fn(async () => 1),
    resumeAll: vi.fn(async () => 0),
    terminate: vi.fn(async () => 1),
    fetchUsage: vi.fn(async () => usage),
    wake: vi.fn(async () => ({ ok: true })),
  } satisfies AgentQuotaAPI
  const timers: Array<() => void> = []
  const engine = new QuotaEngine({
    api,
    now: () => now,
    random: () => 0,
    setTimer: (run) => { timers.push(run); return timers.length },
    clearTimer: vi.fn(),
  })
  updateQuota((state) => ({ ...state, config }))
  engine.setInputs({ sessionIds: ['s1', 's2'], busy: {} })
  const run = async (at = now) => {
    now = at
    await engine.tick()
    await engine.settle()
  }
  return {
    api, engine, run, timers,
    setRows: (next: SessionAgent[]) => { rows = next },
    setUsage: (next: QuotaSnapshot) => { usage = next },
    advance: (ms: number) => { now += ms; return now },
  }
}

const withAgent = (patch: Partial<QuotaConfig['agents']['claude']>): QuotaConfig => ({
  ...DEFAULT_QUOTA_CONFIG,
  agents: { ...DEFAULT_QUOTA_CONFIG.agents, claude: { ...DEFAULT_QUOTA_CONFIG.agents.claude, ...patch } },
})

beforeEach(() => resetQuotaStore())

describe('QuotaEngine', () => {
  it('detects terminals, reads their profile and schedules the next read from history', async () => {
    const { api, run } = setup()
    await run()
    const state = getQuotaState()
    expect(state.terminals.s1).toMatchObject({ instanceKey: 's1:10:100', profileKey: 'claude:c:\\p\\work' })
    expect(api.fetchUsage).toHaveBeenCalledWith({ agent: 'claude', profileDir: 'C:\\p\\work', launcher: null })
    const profile = state.profiles['claude:c:\\p\\work']
    expect(profile).toMatchObject({ fetching: false, errorStreak: 0, history: [{ at: T0, usedPct: 40 }] })
    expect(profile.nextFetchAt - T0).toBe(280_000)
    expect(state.now).toBe(T0)
  })

  it('ignores sessions not open here and does not read agents switched off', async () => {
    const { api, run, setRows } = setup(withAgent({ enabled: true }))
    setRows([agent({ sessionId: 'elsewhere' }), agent({ sessionId: 's2', agent: 'codex', profileDir: null, profileName: 'codex' })])
    updateQuota((state) => ({ ...state, config: { ...state.config, agents: { ...state.config.agents, codex: { ...state.config.agents.codex, enabled: false } } } }))
    await run()
    expect(getQuotaState().terminals).toMatchObject({ s2: { agent: 'codex' } })
    expect(api.fetchUsage).not.toHaveBeenCalled()
  })

  it('suspends at the limit, guards on a fast cadence, and catches late sub-agents', async () => {
    const { api, run, setUsage, advance } = setup()
    setUsage(reading(95))
    await run()
    expect(api.suspend).toHaveBeenCalledWith('s1', 10, 100)
    const state = getQuotaState()
    expect(state.guards['s1:10:100'].phase).toBe('guarding')
    const profile = state.profiles['claude:c:\\p\\work']
    expect(profile.nextFetchAt - T0).toBe(15_000)
    expect(state.notices.at(-1)?.message).toContain('suspended')

    await run(advance(15_000))
    expect(api.suspend).toHaveBeenCalledTimes(2)
    expect(getQuotaState().notices.at(-1)?.message).toContain('Froze 1 more AI process')
  })

  it('stops polling fast once the guard settles into suspended', async () => {
    const { run, setUsage } = setup(withAgent({ guardMinutes: 1 }))
    setUsage(reading(95))
    await run()
    const later = T0 + 61_000
    setUsage(reading(95, 20, later))
    await run(later)
    const state = getQuotaState()
    expect(state.guards['s1:10:100'].phase).toBe('suspended')
    // Frozen agents spend nothing: at most every five minutes until the reset.
    expect(state.profiles['claude:c:\\p\\work'].nextFetchAt - later).toBe(300_000)
  })

  it('falls back to active when nothing could be frozen', async () => {
    const { api, run, setUsage } = setup()
    api.suspend.mockResolvedValueOnce({ frozen: [], newlyFrozen: 0, errors: ['access denied'] })
    setUsage(reading(95))
    await run()
    expect(getQuotaState().guards['s1:10:100'].phase).toBe('active')
    expect(getQuotaState().notices.at(-1)).toMatchObject({ level: 'danger', message: expect.stringContaining('access denied') })
  })

  it('treats a throwing suspend as a failure', async () => {
    const { api, run, setUsage } = setup()
    api.suspend.mockRejectedValueOnce('gone')
    setUsage(reading(95))
    await run()
    expect(getQuotaState().guards['s1:10:100'].phase).toBe('active')
    api.suspend.mockRejectedValueOnce('gone again')
    updateQuota((state) => ({ ...state, guards: { 's1:10:100': { ...state.guards['s1:10:100'], phase: 'guarding', window: 'session' } } }))
    await run()
    expect(getQuotaState().guards['s1:10:100'].phase).toBe('guarding')
  })

  it('disposes an override and thaws when another agent replaces the instance', async () => {
    const { api, run, setRows, setUsage, advance } = setup()
    setUsage(reading(95))
    await run()
    setOverride('s1:10:100', { limits: { session: 99 } })
    setRows([agent({ pid: 11, startTime: 200, agent: 'codex', profileDir: null, profileName: 'codex' })])
    await run(advance(6000))
    const state = getQuotaState()
    expect(state.overrides).toEqual({})
    expect(state.guards['s1:10:100']).toBeUndefined()
    expect(api.resume).toHaveBeenCalledWith('s1')
    expect(state.terminals.s1.instanceKey).toBe('s1:11:200')
  })

  it('thaws a held agent once its guard is switched off', async () => {
    const { api, run, setUsage, advance } = setup()
    setUsage(reading(95))
    await run()
    setOverride('s1:10:100', { suspendAtLimit: false })
    await run(advance(1000))
    expect(api.resume).toHaveBeenCalledWith('s1')
    expect(getQuotaState().guards['s1:10:100'].phase).toBe('active')
  })

  it('continues monitoring after an automatic reset resume', async () => {
    const { api, run, setUsage, advance } = setup(withAgent({ guardMinutes: 1 }))
    setUsage(reading(95))
    await run()
    await run(advance(61_000))
    expect(getQuotaState().guards['s1:10:100'].phase).toBe('suspended')

    setUsage(reading(10, 20, RESET + 3 * 60_000))
    await run(RESET + 3 * 60_000)
    expect(getQuotaState().guards['s1:10:100'].phase).toBe('active')
    expect(api.resume).toHaveBeenCalledWith('s1')

    setUsage(reading(95, 20, RESET + 4 * 60_000))
    updateQuota((state) => ({
      ...state,
      profiles: { ...state.profiles, 'claude:c:\\p\\work': { ...state.profiles['claude:c:\\p\\work'], nextFetchAt: 0 } },
    }))
    await run(RESET + 4 * 60_000)
    expect(api.suspend).toHaveBeenCalledTimes(3)
    expect(getQuotaState().guards['s1:10:100'].phase).toBe('guarding')
  })

  it('pauses only the resumed agent instance and monitors a newly started instance', async () => {
    const { api, run, setRows, setUsage, advance, engine } = setup()
    setUsage(reading(95))
    await run()
    engine.resume('s1')
    await engine.settle()
    expect(getQuotaState().overrides['s1:10:100']).toMatchObject({ enabled: false, suspendAtLimit: false })

    setRows([agent({ pid: 11, startTime: 200 })])
    setUsage(reading(95))
    engine.refresh()
    await run(advance(6000))
    expect(getQuotaState().terminals.s1.instanceKey).toBe('s1:11:200')
    expect(getQuotaState().overrides).toEqual({})
    expect(api.suspend).toHaveBeenCalledTimes(2)
  })

  it('does nothing but release when the feature is disabled', async () => {
    const { api, run } = setup({ ...DEFAULT_QUOTA_CONFIG, enabled: false })
    await run()
    expect(api.detect).not.toHaveBeenCalled()
  })

  it('keeps the last good reading through errors and backs off', async () => {
    const { run, setUsage, advance } = setup()
    await run()
    setUsage({ windows: [], fetchedAt: T0, error: 'timeout' })
    updateQuota((state) => ({ ...state, profiles: { ...state.profiles, 'claude:c:\\p\\work': { ...state.profiles['claude:c:\\p\\work'], nextFetchAt: 0 } } }))
    const at = advance(1000)
    await run(at)
    const profile = getQuotaState().profiles['claude:c:\\p\\work']
    expect(profile.errorStreak).toBe(1)
    expect(profile.lastGood?.windows[0].usedPct).toBe(40)
    expect(profile.nextFetchAt - at).toBe(30_000)
  })

  it('wakes by hand for one terminal or every active profile, skipping a spent week', async () => {
    const { api, run, engine } = setup()
    await run()
    engine.wake({ sessionId: 's1' })
    await engine.settle()
    expect(api.wake).toHaveBeenCalledWith({ agent: 'claude', profileDir: 'C:\\p\\work', launcher: null, prompt: 'hi' })
    expect(getQuotaState().notices.at(-1)?.message).toContain('Woke Claude Code (work)')
    api.wake.mockResolvedValueOnce({ ok: false })
    engine.wake('all')
    await engine.settle()
    expect(getQuotaState().notices.at(-1)).toMatchObject({ level: 'danger', message: expect.stringContaining('unknown error') })
    engine.wake({ sessionId: 'missing' })
    await engine.settle()
    expect(api.wake).toHaveBeenCalledTimes(2)
  })

  it('refuses to wake a spent week', async () => {
    const { api, run, engine, setUsage } = setup()
    setUsage(reading(10, 99))
    await run()
    engine.wake('all')
    await engine.settle()
    expect(api.wake).not.toHaveBeenCalled()
    expect(getQuotaState().notices.at(-1)?.message).toContain('weekly limit')
  })

  it('fires the scheduled afterReset wake for a suspended profile', async () => {
    const { api, run, setUsage } = setup(withAgent({ wake: { mode: 'afterReset', time: '06:00', delayMinutes: 2, prompt: 'hello' } }))
    setUsage(reading(95))
    await run()
    expect(getQuotaState().guards['s1:10:100'].phase).toBe('guarding')
    setUsage({ ...reading(95, 20, RESET + 3 * 60_000), windows: [{ kind: 'session', label: 's', usedPct: 95, resetsAt: RESET + 5 * 3_600_000 }] })
    await run(RESET + 3 * 60_000)
    expect(api.wake).toHaveBeenCalledWith({ agent: 'claude', profileDir: 'C:\\p\\work', launcher: null, prompt: 'hello' })
  })

  it('uses a terminal wake override for scheduled wake-up', async () => {
    const { api, run, setUsage } = setup()
    setOverride('s1:10:100', { wake: { mode: 'afterReset', time: '06:00', delayMinutes: 2, prompt: 'terminal hello' } })
    setUsage(reading(95))
    await run()
    setUsage({ ...reading(95, 20, RESET + 3 * 60_000), windows: [{ kind: 'session', label: 's', usedPct: 95, resetsAt: RESET + 5 * 3_600_000 }] })
    await run(RESET + 3 * 60_000)
    expect(api.wake).toHaveBeenCalledWith({ agent: 'claude', profileDir: 'C:\\p\\work', launcher: null, prompt: 'terminal hello' })
  })

  it('resumes by hand and refreshes on request', async () => {
    const { api, run, engine, setUsage } = setup()
    setUsage(reading(95))
    await run()
    engine.resumeAll()
    await engine.settle()
    expect(api.resume).toHaveBeenCalledWith('s1')
    expect(getQuotaState().guards['s1:10:100'].bypassUntil).toBe(RESET)
    engine.resume('missing')
    engine.refresh()
    engine.refresh('claude:c:\\p\\work')
    expect(getQuotaState().profiles['claude:c:\\p\\work'].nextFetchAt).toBe(0)
  })

  it('keys a launcher profile by its directory, reads it through the launcher, and survives a failed detect', async () => {
    const { api, run, engine, setRows, advance } = setup()
    setRows([agent({ launcher: 'claude-th', profileName: 'claude-th' })])
    await run()
    expect(getQuotaState().terminals.s1.profileKey).toBe('claude:c:\\p\\work')
    expect(api.fetchUsage).toHaveBeenCalledWith({ agent: 'claude', profileDir: 'C:\\p\\work', launcher: 'claude-th' })
    engine.wake({ sessionId: 's1' })
    await engine.settle()
    expect(api.wake).toHaveBeenCalledWith({ agent: 'claude', profileDir: 'C:\\p\\work', launcher: 'claude-th', prompt: 'hi' })
    api.detect.mockRejectedValueOnce(new Error('ipc'))
    await run(advance(6000))
    expect(getQuotaState().terminals.s1).toBeDefined()
  })

  it('lists a launcher terminal and a plain terminal on the same directory as one profile (regression)', async () => {
    const { api, run, setRows } = setup()
    setRows([
      agent({ profileDir: 'C:\\p\\work\\', profileName: 'work' }),
      agent({ sessionId: 's2', pid: 11, profileDir: 'c:/p/work', launcher: 'claude-th', profileName: 'claude-th' }),
    ])
    await run()
    const state = getQuotaState()
    expect(Object.keys(state.profiles)).toEqual(['claude:c:\\p\\work'])
    expect(state.terminals.s2.profileKey).toBe(state.terminals.s1.profileKey)
    expect(state.profiles['claude:c:\\p\\work']).toMatchObject({ profileName: 'claude-th', launcher: 'claude-th' })
    expect(api.fetchUsage).toHaveBeenCalledTimes(1)
    expect(api.fetchUsage).toHaveBeenCalledWith(expect.objectContaining({ launcher: 'claude-th' }))
  })

  it('keys a launcher by name when only the default directory is known', async () => {
    const { run, setRows } = setup()
    setRows([
      agent({ profileDir: 'C:\\Users\\me\\.claude', launcher: 'claude-th', profileName: 'claude-th' }),
      agent({ sessionId: 's2', pid: 11, profileDir: 'C:\\Users\\me\\.claude', profileName: 'claude' }),
    ])
    await run()
    expect(getQuotaState().terminals.s1.profileKey).toBe('claude:launcher:claude-th')
    expect(getQuotaState().terminals.s2.profileKey).toBe('claude:c:\\users\\me\\.claude')
  })

  it('runs its own loop until stopped', async () => {
    const { engine, timers, api } = setup()
    engine.start()
    engine.start()
    await vi.waitFor(() => expect(timers).toHaveLength(1))
    timers[0]()
    await vi.waitFor(() => expect(timers).toHaveLength(2))
    engine.stop()
    timers[1]()
    await engine.settle()
    expect(api.detect).toHaveBeenCalledTimes(1)
    engine.stop()
  })
})
