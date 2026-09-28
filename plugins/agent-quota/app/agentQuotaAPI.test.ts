import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

import { createAgentQuotaAPI, listAgentProfiles, parseDiscoveredProfiles, parseSessionAgents, parseSnapshot } from './agentQuotaAPI'

describe('parseSessionAgents', () => {
  it('keeps well-formed rows and drops the rest', () => {
    expect(parseSessionAgents([
      { sessionId: 's1', agent: 'claude', pid: 5, startTime: 9, profileDir: 'C:\\p', profileName: 'p', subAgentCount: 2, launcher: null },
      { sessionId: 's2', agent: 'codex', pid: 6, startTime: 9, profileName: 'codex-alt', launcher: 'codex-alt' },
      { sessionId: 's3', agent: 'antigravity', pid: 1, startTime: 1, profileName: 'x' },
      { sessionId: 's4', agent: 'codex', pid: -1, startTime: 1, profileName: 'x' },
      { sessionId: 5 },
      'junk',
    ])).toEqual([
      { sessionId: 's1', agent: 'claude', pid: 5, startTime: 9, profileDir: 'C:\\p', profileName: 'p', subAgentCount: 2, launcher: null },
      { sessionId: 's2', agent: 'codex', pid: 6, startTime: 9, profileDir: null, profileName: 'codex-alt', subAgentCount: 0, launcher: 'codex-alt' },
    ])
    expect(parseSessionAgents(null)).toEqual([])
    for (const launcher of ['C:\\x\\claude-th.cmd', 'claude-a b', 7]) {
      expect(parseSessionAgents([{ sessionId: 'a', agent: 'claude', pid: 1, startTime: 1, profileName: 'p', launcher }])[0].launcher).toBeNull()
    }
  })
})

describe('parseSnapshot', () => {
  it('validates windows, clamps values and keeps optional fields', () => {
    expect(parseSnapshot({
      windows: [
        { kind: 'session', usedPct: 120, label: 'S', resetsAt: 5, breakdown: [{ label: 'a', usedPct: 1 }, { label: 2 }] },
        { kind: 'weekly', usedPct: 'x' },
        { kind: 'yearly', usedPct: 1 },
        { kind: 'monthly', usedPct: -3 },
      ],
      fetchedAt: 7,
      source: 'cli',
      error: 'timeout',
      message: 'm'.repeat(400),
      credits: { balance: 3, unlimited: true },
    }, 1)).toEqual({
      windows: [
        { kind: 'session', usedPct: 100, label: 'S', resetsAt: 5, breakdown: [{ label: 'a', usedPct: 1 }] },
        { kind: 'monthly', usedPct: 0, label: 'monthly' },
      ],
      fetchedAt: 7,
      source: 'cli',
      error: 'timeout',
      message: 'm'.repeat(300),
      credits: { balance: 3, unlimited: true },
    })
    expect(parseSnapshot({ windows: 'no', credits: { balance: 'x' } }, 9)).toEqual({ windows: [], fetchedAt: 9, credits: { balance: null, unlimited: false } })
    expect(parseSnapshot(null, 9)).toMatchObject({ error: 'failed', fetchedAt: 9 })
    expect(parseSnapshot(undefined).fetchedAt).toBeGreaterThan(0)
  })
})

describe('createAgentQuotaAPI', () => {
  beforeEach(() => invoke.mockReset())

  it('sends exact command payloads and parses the answers', async () => {
    const api = createAgentQuotaAPI()
    invoke.mockResolvedValueOnce({ name: 'Agent Quota' })
    expect(await api.info()).toBe(true)
    expect(invoke).toHaveBeenLastCalledWith('plugin_invoke', { method: 'agentQuota.info', args: [] })
    invoke.mockRejectedValueOnce(new Error('no plugin'))
    expect(await api.info()).toBe(false)

    invoke.mockResolvedValueOnce([])
    expect(await api.detect()).toEqual([])
    expect(invoke).toHaveBeenLastCalledWith('agent_quota_detect')

    invoke.mockResolvedValueOnce({ frozen: [{ pid: 1, startTime: 2, image: 'claude.exe' }, { pid: 'x' }], newlyFrozen: 1, errors: ['e', 3] })
    expect(await api.suspend('s', 1, 2)).toEqual({ frozen: [{ pid: 1, startTime: 2, image: 'claude.exe' }], newlyFrozen: 1, errors: ['e'] })
    expect(invoke).toHaveBeenLastCalledWith('agent_quota_suspend', { sessionId: 's', pid: 1, startTime: 2 })
    invoke.mockResolvedValueOnce(null)
    expect(await api.suspend('s', 1, 2)).toEqual({ frozen: [], newlyFrozen: 0, errors: [] })

    invoke.mockResolvedValueOnce(2)
    expect(await api.resume('s')).toBe(2)
    expect(invoke).toHaveBeenLastCalledWith('agent_quota_resume', { sessionId: 's' })
    invoke.mockResolvedValueOnce('x')
    expect(await api.resumeAll()).toBe(0)
    expect(invoke).toHaveBeenLastCalledWith('agent_quota_resume_all')
    invoke.mockResolvedValueOnce(1)
    expect(await api.terminate('s', 1, 2)).toBe(1)
    expect(invoke).toHaveBeenLastCalledWith('agent_quota_terminate', { sessionId: 's', pid: 1, startTime: 2 })
  })

  it('routes usage and wake through the plugin and never throws', async () => {
    const api = createAgentQuotaAPI()
    invoke.mockResolvedValueOnce({ windows: [], fetchedAt: 1 })
    expect(await api.fetchUsage({ agent: 'codex' })).toEqual({ windows: [], fetchedAt: 1 })
    expect(invoke).toHaveBeenLastCalledWith('plugin_invoke', { method: 'agentQuota.fetchUsage', args: [{ agent: 'codex' }] })
    invoke.mockRejectedValueOnce('sidecar down')
    expect(await api.fetchUsage({ agent: 'codex' })).toMatchObject({ error: 'failed', message: 'sidecar down' })

    invoke.mockResolvedValueOnce({ ok: true })
    expect(await api.wake({ agent: 'claude', prompt: 'hi' })).toEqual({ ok: true, message: undefined })
    invoke.mockResolvedValueOnce({ ok: false, message: 'nope' })
    expect(await api.wake({ agent: 'claude', prompt: 'hi' })).toEqual({ ok: false, message: 'nope' })
    invoke.mockResolvedValueOnce(null)
    expect(await api.wake({ agent: 'claude', prompt: 'hi' })).toEqual({ ok: false, message: 'No answer.' })
    invoke.mockRejectedValueOnce('boom')
    expect(await api.wake({ agent: 'claude', prompt: 'hi' })).toEqual({ ok: false, message: 'boom' })
  })
})

describe('parseDiscoveredProfiles', () => {
  it('keeps launchers for their own agent and default directories, drops the rest', () => {
    expect(parseDiscoveredProfiles([
      { agent: 'claude', profileName: 'claude', profileDir: 'C:\\Users\\me\\.claude', launcher: null },
      { agent: 'claude', profileName: 'claude-work', profileDir: null, launcher: 'claude-work' },
      { agent: 'claude', profileName: 'x', launcher: 'codex-alt' },
      { agent: 'claude', profileName: 'x', launcher: 'C:\\bin\\claude-x.cmd' },
      { agent: 'claude', profileName: 'x', launcher: 'claude-a & calc' },
      { agent: 'claude', profileName: '', launcher: 'claude-a' },
      { agent: 'claude', profileName: 'n'.repeat(81), launcher: 'claude-a' },
      { agent: 'claude', profileName: 'nothing', profileDir: null, launcher: null },
      { agent: 'gemini', profileName: 'g', launcher: null, profileDir: 'x' },
      'junk',
    ])).toEqual([
      { agent: 'claude', profileName: 'claude', profileDir: 'C:\\Users\\me\\.claude', launcher: null },
      { agent: 'claude', profileName: 'claude-work', profileDir: null, launcher: 'claude-work' },
    ])
    expect(parseDiscoveredProfiles({})).toEqual([])
  })

  it('asks the sidecar and treats a missing plugin as no profiles', async () => {
    invoke.mockReset()
    invoke.mockResolvedValueOnce([{ agent: 'codex', profileName: 'codex-alt', profileDir: null, launcher: 'codex-alt' }])
    expect(await listAgentProfiles()).toEqual([{ agent: 'codex', profileName: 'codex-alt', profileDir: null, launcher: 'codex-alt' }])
    expect(invoke).toHaveBeenLastCalledWith('plugin_invoke', { method: 'agentQuota.listProfiles', args: [] })
    invoke.mockRejectedValueOnce(new Error('no plugin'))
    expect(await listAgentProfiles()).toEqual([])
  })
})
