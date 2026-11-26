import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const listen = vi.fn()
const scan = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => listen(...args) }))
vi.mock('../../../utils/paneAgentScan', () => ({ scanPaneAgents: (...args: unknown[]) => scan(...args) }))

import {
  createAgentQuotaAPI,
  listAgentProfiles,
  parseDiscoveredProfiles,
  parseFrozenList,
  parseFrozenProcess,
  parseSessionAgents,
  parseSnapshot,
} from '../agentQuotaAPI'

const agentRow = { sessionId: 's', agent: 'claude', pid: 4, startTime: 9, profileName: 'work' }

describe('parseSessionAgents', () => {
  it('drops malformed rows and defaults the optional fields', () => {
    expect(parseSessionAgents('nope')).toEqual([])
    const rows = parseSessionAgents([
      agentRow,
      { ...agentRow, agent: 'gpt' },
      { ...agentRow, pid: -1 },
      { ...agentRow, profileName: 4 },
      null,
      { ...agentRow, profileDir: 'C:/p', subAgentCount: 2, launcher: 'claude-th' },
      { ...agentRow, launcher: '../claude-th', subAgentCount: 1.5 },
    ])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ profileDir: null, subAgentCount: 0, launcher: null })
    expect(rows[1]).toMatchObject({ profileDir: 'C:/p', subAgentCount: 2, launcher: 'claude-th' })
    expect(rows[2]).toMatchObject({ launcher: null, subAgentCount: 0 })
  })
})

describe('parseSnapshot', () => {
  it('turns an unreadable answer into an error snapshot', () => {
    expect(parseSnapshot(null, 7)).toMatchObject({ windows: [], fetchedAt: 7, error: 'failed' })
  })

  it('keeps valid windows, clamps usage and trims the message', () => {
    const snapshot = parseSnapshot({
      windows: [
        { kind: 'session', usedPct: 140, label: 'Session', resetsAt: 55, breakdown: [{ label: 'a', usedPct: 1 }, { label: 3 }] },
        { kind: 'weekly', usedPct: -5 },
        { kind: 'yearly', usedPct: 1 },
        { kind: 'monthly', usedPct: Number.NaN },
        { kind: 'monthly', usedPct: 10, breakdown: [] },
        'bad',
      ],
      fetchedAt: 11,
      source: 'api',
      error: 'failed',
      message: 'x'.repeat(400),
      credits: { balance: 5, unlimited: true },
    }, 1)
    expect(snapshot.windows).toHaveLength(3)
    expect(snapshot.windows[0]).toMatchObject({ usedPct: 100, resetsAt: 55, breakdown: [{ label: 'a', usedPct: 1 }] })
    expect(snapshot.windows[1]).toMatchObject({ usedPct: 0, label: 'weekly' })
    expect(snapshot.windows[2]?.breakdown).toBeUndefined()
    expect(snapshot).toMatchObject({ fetchedAt: 11, source: 'api', error: 'failed', credits: { balance: 5, unlimited: true } })
    expect(snapshot.message).toHaveLength(300)
  })

  it('falls back for a missing window list, time and credit balance', () => {
    const snapshot = parseSnapshot({ credits: { balance: 'x' } }, 3)
    expect(snapshot).toMatchObject({ windows: [], fetchedAt: 3, credits: { balance: null, unlimited: false } })
  })
})

describe('frozen process parsing', () => {
  it('accepts a full entry and rejects broken ones', () => {
    expect(parseFrozenProcess({ pid: 1, startTime: 2, image: 'a.exe', threads: [1, 'x', 3], profileName: 'p' }))
      .toEqual({ pid: 1, startTime: 2, image: 'a.exe', threads: [1, 3], profileName: 'p' })
    expect(parseFrozenProcess({ pid: 1, startTime: 2, image: 'a.exe', profileName: '' }))
      .toEqual({ pid: 1, startTime: 2, image: 'a.exe' })
    expect(parseFrozenProcess({ pid: 1.5, startTime: 2, image: 'a' })).toBeNull()
    expect(parseFrozenProcess([])).toBeNull()
    expect(parseFrozenList('x')).toEqual([])
    expect(parseFrozenList([{ pid: 1, startTime: 2, image: 'a' }, null])).toHaveLength(1)
  })
})

describe('parseDiscoveredProfiles', () => {
  it('accepts only coherent launcher and directory pairs', () => {
    expect(parseDiscoveredProfiles(1)).toEqual([])
    const rows = parseDiscoveredProfiles([
      { agent: 'claude', profileName: 'a', launcher: 'claude-th', profileDir: 'C:/a' },
      { agent: 'claude', profileName: 'b', launcher: null, profileDir: 'C:/b' },
      { agent: 'codex', profileName: 'c', profileDir: null, launcher: 'codex-x' },
      { agent: 'claude', profileName: 'd', launcher: 'codex-x', profileDir: 'C:/d' },
      { agent: 'claude', profileName: 'e', launcher: 7, profileDir: 'C:/d' },
      { agent: 'claude', profileName: 'f', launcher: null, profileDir: null },
      { agent: 'claude', profileName: '', launcher: null, profileDir: 'C:/g' },
      { agent: 'claude', profileName: 'h'.repeat(81), launcher: null, profileDir: 'C:/g' },
      { agent: 'claude', profileName: 'i', launcher: null, profileDir: 'x'.repeat(1025) },
      { agent: 'nope', profileName: 'j' },
    ])
    expect(rows.map((row) => row.profileName)).toEqual(['a', 'b', 'c'])
    expect(rows[2]).toMatchObject({ profileDir: null, launcher: 'codex-x' })
  })

  it('lists no profiles when the command fails', async () => {
    invoke.mockRejectedValueOnce(new Error('off'))
    await expect(listAgentProfiles()).resolves.toEqual([])
    invoke.mockResolvedValueOnce([{ agent: 'agy', profileName: 'p', launcher: null, profileDir: 'C:/p' }])
    await expect(listAgentProfiles()).resolves.toHaveLength(1)
  })
})

describe('createAgentQuotaAPI', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports the switch and detects agents, fresh or cached', async () => {
    const api = createAgentQuotaAPI()
    invoke.mockResolvedValueOnce(true)
    await expect(api.info()).resolves.toBe(true)
    invoke.mockRejectedValueOnce(new Error('x'))
    await expect(api.info()).resolves.toBe(false)
    scan.mockResolvedValue([agentRow])
    await expect(api.detect(true)).resolves.toHaveLength(1)
    expect(scan).toHaveBeenLastCalledWith(0)
    await api.detect()
    expect(scan).toHaveBeenLastCalledWith(undefined)
  })

  it('subscribes to plugin changes and releases on unsubscribe', async () => {
    const unlisten = vi.fn()
    let handler: () => void = () => {}
    listen.mockImplementation(async (_name: string, cb: () => void) => {
      handler = cb
      return unlisten
    })
    const api = createAgentQuotaAPI()
    const listener = vi.fn()
    const stop = api.onPluginsChanged!(listener)
    await Promise.resolve()
    handler()
    expect(listener).toHaveBeenCalledOnce()
    stop()
    expect(unlisten).toHaveBeenCalledOnce()
    const early = api.onPluginsChanged!(listener)
    early()
    await Promise.resolve()
    await Promise.resolve()
    expect(unlisten).toHaveBeenCalledTimes(2)
    listen.mockRejectedValueOnce(new Error('x'))
    api.onPluginsChanged!(listener)
  })

  it('normalizes suspend, resume and terminate results', async () => {
    const api = createAgentQuotaAPI()
    invoke.mockResolvedValueOnce({ frozen: [{ pid: 1, startTime: 2, image: 'a' }], newlyFrozen: 1, errors: ['e', 3] })
    await expect(api.suspend('s', 1, 2)).resolves.toEqual({
      frozen: [{ pid: 1, startTime: 2, image: 'a' }], newlyFrozen: 1, errors: ['e'],
    })
    invoke.mockResolvedValueOnce(null)
    await expect(api.suspend('s', 1, 2)).resolves.toEqual({ frozen: [], newlyFrozen: 0, errors: [] })
    invoke.mockResolvedValueOnce(3)
    await expect(api.resume('s')).resolves.toBe(3)
    invoke.mockResolvedValueOnce('x')
    await expect(api.resumeAll()).resolves.toBe(0)
    invoke.mockResolvedValueOnce(2)
    await expect(api.terminate('s', 1, 2)).resolves.toBe(2)
  })

  it('treats resumePid and getHeld failures as empty', async () => {
    const api = createAgentQuotaAPI()
    invoke.mockResolvedValueOnce(true)
    await expect(api.resumePid!('s', 1)).resolves.toBe(true)
    invoke.mockRejectedValueOnce(new Error('x'))
    await expect(api.resumePid!('s', 1)).resolves.toBe(false)
    invoke.mockResolvedValueOnce([{ pid: 1, startTime: 2, image: 'a' }])
    await expect(api.getHeld!('s')).resolves.toHaveLength(1)
    expect(invoke).toHaveBeenLastCalledWith('agent_quota_get_held', { sessionId: 's' })
    invoke.mockRejectedValueOnce(new Error('x'))
    await expect(api.getHeld!()).resolves.toEqual([])
    expect(invoke).toHaveBeenLastCalledWith('agent_quota_get_held', { sessionId: null })
  })

  it('turns usage and wake failures into error results', async () => {
    const api = createAgentQuotaAPI()
    invoke.mockResolvedValueOnce({ windows: [] })
    await expect(api.fetchUsage({} as never)).resolves.toMatchObject({ windows: [] })
    invoke.mockRejectedValueOnce('boom')
    await expect(api.fetchUsage({} as never)).resolves.toMatchObject({ error: 'failed', message: 'boom' })
    invoke.mockResolvedValueOnce({ ok: true, message: 'awake' })
    await expect(api.wake({} as never)).resolves.toEqual({ ok: true, message: 'awake' })
    invoke.mockResolvedValueOnce({ ok: 1 })
    await expect(api.wake({} as never)).resolves.toEqual({ ok: false, message: undefined })
    invoke.mockResolvedValueOnce('x')
    await expect(api.wake({} as never)).resolves.toEqual({ ok: false, message: 'No answer.' })
    invoke.mockRejectedValueOnce('nope')
    await expect(api.wake({} as never)).resolves.toEqual({ ok: false, message: 'nope' })
  })

  it('accepts only a sane probe directory', async () => {
    const api = createAgentQuotaAPI()
    invoke.mockResolvedValueOnce('C:/probe')
    await expect(api.probeDir!()).resolves.toBe('C:/probe')
    for (const bad of ['', 'a\0b', 'x'.repeat(1025), 4]) {
      invoke.mockResolvedValueOnce(bad)
      await expect(api.probeDir!()).resolves.toBeNull()
    }
    invoke.mockRejectedValueOnce(new Error('x'))
    await expect(api.probeDir!()).resolves.toBeNull()
    invoke.mockResolvedValueOnce(true)
    await api.listProfiles!()
  })
})
