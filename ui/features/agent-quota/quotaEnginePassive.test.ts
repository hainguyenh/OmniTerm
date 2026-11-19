import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DiscoveredProfile, FetchUsageRequest, QuotaSnapshot } from './usage/types'
import type { AgentQuotaAPI, SessionAgent } from './agentQuotaAPI'

import { DEFAULT_QUOTA_CONFIG } from './quotaConfig'
import { QuotaEngine } from './quotaEngine'
import { getQuotaState, resetQuotaStore, updateQuota } from './quotaStore'

const T0 = Date.UTC(2026, 10, 18, 3, 0)

const agent = (overrides: Partial<SessionAgent> = {}): SessionAgent => ({
  sessionId: 's1', agent: 'claude', pid: 10, startTime: T0 / 1000, profileDir: 'C:\\p\\work', profileName: 'work',
  subAgentCount: 0, launcher: null, ...overrides,
})

const reading: QuotaSnapshot = { windows: [{ kind: 'session', label: 's', usedPct: 30 }], fetchedAt: T0, source: 'statusline' }

const profile = (agentKind: DiscoveredProfile['agent'], profileDir: string | null, launcher: string | null = null): DiscoveredProfile => ({
  agent: agentKind, profileName: launcher ?? agentKind, profileDir, launcher,
})

function setup(profiles: DiscoveredProfile[], passive: (request: FetchUsageRequest) => boolean) {
  let now = T0
  const api = {
    info: vi.fn(async () => true),
    detect: vi.fn(async (): Promise<SessionAgent[]> => []),
    suspend: vi.fn(async () => ({ frozen: [], newlyFrozen: 0, errors: [] as string[] })),
    resume: vi.fn(async () => 1),
    resumeAll: vi.fn(async () => 0),
    terminate: vi.fn(async () => 1),
    fetchUsage: vi.fn(async () => reading),
    wake: vi.fn(async () => ({ ok: true })),
    listProfiles: vi.fn(async () => profiles),
    ensurePassive: vi.fn(async (request: FetchUsageRequest) => passive(request)),
  } satisfies AgentQuotaAPI
  const launchHold = { hold: vi.fn(), release: vi.fn() }
  const probe = vi.fn(async () => reading)
  const engine = new QuotaEngine({
    api, now: () => now, random: () => 0, setTimer: () => 0, clearTimer: vi.fn(), inlineProbe: probe, launchHold,
  })
  updateQuota((state) => ({ ...state, config: DEFAULT_QUOTA_CONFIG }))
  engine.setInputs({ sessionIds: ['s1'], busy: {} })
  const run = async (at: number) => {
    now = at
    await engine.tick()
    await engine.settle()
  }
  return { api, engine, launchHold, probe, run }
}

beforeEach(() => resetQuotaStore())

describe('QuotaEngine with profiles that report their quota by themselves', () => {
  it('installs the bridges once at start-up, for monitored agents only', async () => {
    const off = { ...DEFAULT_QUOTA_CONFIG, agents: { ...DEFAULT_QUOTA_CONFIG.agents, codex: { ...DEFAULT_QUOTA_CONFIG.agents.codex, enabled: false } } }
    const { api, run } = setup([profile('claude', 'C:\\p\\work'), profile('codex', 'C:\\c')], () => true)
    updateQuota((state) => ({ ...state, config: off }))
    await run(T0)
    await run(T0 + 1_000)
    expect(api.listProfiles).toHaveBeenCalledTimes(1)
    expect(api.ensurePassive).toHaveBeenCalledTimes(1)
    expect(api.ensurePassive).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', profileDir: 'C:\\p\\work' }))
  })

  it('neither freezes nor types into a launch whose profile reports by itself', async () => {
    const { api, engine, launchHold, probe, run } = setup([profile('claude', 'C:\\p\\work')], () => true)
    await run(T0)
    engine.noteLaunch('s1', 'claude')
    expect(launchHold.hold).not.toHaveBeenCalled()
    api.detect.mockResolvedValue([agent()])
    await run(T0 + 5_000)
    expect(probe).not.toHaveBeenCalled()
    expect(launchHold.release).toHaveBeenCalledWith('s1')
    // The background read takes over for a profile with no reading yet, once its agent had a
    // moment to report through the bridge.
    await run(T0 + 6_000)
    expect(api.fetchUsage).not.toHaveBeenCalled()
    await run(T0 + 13_000)
    expect(api.fetchUsage).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude' }))
    expect(getQuotaState().profiles['claude:c:\\p\\work']?.snapshot?.source).toBe('statusline')
  })

  it('keeps the hold and the inline probe as the fallback for any other profile', async () => {
    const { api, engine, launchHold, probe, run } = setup(
      [profile('claude', 'C:\\p\\work'), profile('claude', null, 'claude-x')],
      (request) => request.launcher == null,
    )
    await run(T0)
    engine.noteLaunch('s1', 'claude')
    expect(launchHold.hold).toHaveBeenCalledWith('s1')
    api.detect.mockResolvedValue([agent({ profileDir: null, launcher: 'claude-x', profileName: 'claude-x' })])
    await run(T0 + 1_000)
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ launcher: 'claude-x' }))
  })
})
