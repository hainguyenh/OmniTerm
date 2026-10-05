import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentQuotaAPI, SuspendReport } from '../agentQuotaAPI'
import type { GuardAction, GuardState } from '../quotaGuard'

import { DEFAULT_QUOTA_CONFIG, type QuotaConfig } from '../quotaConfig'
import { INITIAL_GUARD, stepGuard } from '../quotaGuard'
import { getQuotaState, resetQuotaStore, setOverride, updateQuota } from '../quotaStore'
import { isProbingUsage } from '../inlineUsageProbe'
import { scheduleResumeRecovery } from '../resumeRecovery'
import { releaseUnguarded, resumeByHand, runGuards, subjectOf, suspendByHand } from '../guardRunner'
import { NOW, reading, seed, terminal } from './quotaFixtures'

vi.mock('../quotaGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quotaGuard')>()
  return { ...actual, stepGuard: vi.fn(actual.stepGuard) }
})

vi.mock('../inlineUsageProbe', () => ({ isProbingUsage: vi.fn(() => false) }))
vi.mock('../resumeRecovery', () => ({ scheduleResumeRecovery: vi.fn() }))

const stepGuardMock = vi.mocked(stepGuard)
const probingMock = vi.mocked(isProbingUsage)
const recoveryMock = vi.mocked(scheduleResumeRecovery)

const PROFILE_KEY = 'claude:c:\\p\\work'
const KEY = 's1:10:100'

const report = (overrides: Partial<SuspendReport> = {}): SuspendReport => ({ frozen: [], newlyFrozen: 0, errors: [], ...overrides })

function makeApi(overrides: Partial<AgentQuotaAPI> = {}): AgentQuotaAPI {
  return {
    info: vi.fn(async () => true),
    detect: vi.fn(async () => []),
    suspend: vi.fn(async () => report({ frozen: [{ pid: 10, startTime: 100, image: 'claude.exe' }] })),
    resume: vi.fn(async () => 1),
    resumeAll: vi.fn(async () => 1),
    terminate: vi.fn(async () => 1),
    fetchUsage: vi.fn(async () => reading(10)),
    wake: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
}

function stepWith(actions: GuardAction[], state: GuardState = { ...INITIAL_GUARD, phase: 'guarding' }) {
  stepGuardMock.mockImplementationOnce(() => ({ state, actions }))
}

const notices = () => getQuotaState().notices.map((notice) => `${notice.level}:${notice.message}`)

function configWith(patch: Partial<QuotaConfig['agents']['claude']>, enabled = true): QuotaConfig {
  return {
    ...DEFAULT_QUOTA_CONFIG,
    enabled,
    agents: { ...DEFAULT_QUOTA_CONFIG.agents, claude: { ...DEFAULT_QUOTA_CONFIG.agents.claude, ...patch } },
  }
}

beforeEach(() => {
  resetQuotaStore()
  stepGuardMock.mockReset()
  probingMock.mockReset()
  probingMock.mockReturnValue(false)
  recoveryMock.mockClear()
})

describe('subjectOf', () => {
  it('names the agent by label and profile', () => {
    expect(subjectOf(terminal({ agent: 'codex', profileName: 'home' }))).toBe('Codex (home)')
  })
})

describe('runGuards', () => {
  it('skips terminals on other profiles, probing terminals and disabled agents', async () => {
    seed({
      config: configWith({ enabled: false }),
      terminals: [
        terminal(),
        terminal({ sessionId: 's2', instanceKey: 's2:1:1', profileKey: 'other' }),
      ],
    })
    await runGuards(makeApi(), PROFILE_KEY, reading(99), NOW)
    expect(stepGuardMock).not.toHaveBeenCalled()

    seed()
    probingMock.mockReturnValue(true)
    await runGuards(makeApi(), PROFILE_KEY, reading(99), NOW)
    expect(stepGuardMock).not.toHaveBeenCalled()
  })

  it('leaves the stored guard alone when the step returns the same state', async () => {
    const guard: GuardState = { ...INITIAL_GUARD, notifiedKey: 'x' }
    seed({ guards: { [KEY]: guard } })
    stepGuardMock.mockImplementationOnce((state) => ({ state, actions: [] }))
    await runGuards(makeApi(), PROFILE_KEY, reading(10), NOW)
    expect(getQuotaState().guards[KEY]).toBe(guard)
  })

  it('runs notify, resume and terminate actions in order', async () => {
    seed()
    const api = makeApi()
    stepWith([
      { type: 'notify', level: 'info', message: 'hello' },
      { type: 'resume', reason: 'reset' },
      { type: 'terminate' },
    ])
    await runGuards(api, PROFILE_KEY, reading(10), NOW)
    expect(getQuotaState().guards[KEY].phase).toBe('guarding')
    expect(notices()).toEqual(['info:hello'])
    expect(api.resume).toHaveBeenCalledWith('s1')
    expect(recoveryMock).toHaveBeenCalledWith('s1', DEFAULT_QUOTA_CONFIG.agents.claude.resumeRecovery)
    expect(api.terminate).toHaveBeenCalledWith('s1', 10, 100)
  })

  it('voids the rest of the step when a suspend froze nothing, quoting the first error', async () => {
    seed()
    const api = makeApi({ suspend: vi.fn(async () => report({ errors: ['access denied'] })) })
    stepWith([{ type: 'suspend' }, { type: 'terminate' }])
    await runGuards(api, PROFILE_KEY, reading(95), NOW)
    expect(api.terminate).not.toHaveBeenCalled()
    expect(getQuotaState().guards[KEY].phase).toBe('active')
    expect(notices()).toEqual(['danger:Could not suspend Claude Code (work): access denied.'])
  })

  it('falls back to a generic reason when an empty suspend reports no error', async () => {
    seed({ guards: { [KEY]: { ...INITIAL_GUARD, lastAttemptAt: 7, notifiedKey: 'n' } } })
    const api = makeApi({ suspend: vi.fn(async () => report()) })
    stepWith([{ type: 'suspend' }])
    await runGuards(api, PROFILE_KEY, reading(95), NOW)
    expect(notices()).toEqual(['danger:Could not suspend Claude Code (work): no process was frozen.'])
    expect(getQuotaState().guards[KEY]).toMatchObject({ phase: 'active', lastAttemptAt: 0, notifiedKey: undefined })
  })

  it('records a failed suspend for a terminal that had no guard stored yet', async () => {
    seed()
    const api = makeApi({
      suspend: vi.fn()
        .mockResolvedValueOnce(report())
        .mockRejectedValueOnce(new Error('gone')),
    })
    stepGuardMock.mockImplementation((state) => ({ state, actions: [{ type: 'suspend' }] }))
    await runGuards(api, PROFILE_KEY, reading(95), NOW)
    expect(getQuotaState().guards[KEY]).toEqual({ ...INITIAL_GUARD, notifiedKey: undefined })

    updateQuota((current) => ({ ...current, guards: {} }))
    await runGuards(api, PROFILE_KEY, reading(95), NOW)
    expect(getQuotaState().guards[KEY]).toEqual({ ...INITIAL_GUARD, notifiedKey: undefined })
    expect(notices()).toEqual([
      'danger:Could not suspend Claude Code (work): no process was frozen.',
      'danger:Could not suspend Claude Code (work): Error: gone',
    ])
  })

  it('reports newly frozen processes on a rescan with singular and plural wording', async () => {
    seed()
    const api = makeApi({
      suspend: vi.fn()
        .mockResolvedValueOnce(report({ newlyFrozen: 1 }))
        .mockResolvedValueOnce(report({ newlyFrozen: 3 }))
        .mockResolvedValueOnce(report({ newlyFrozen: 0 })),
    })
    stepWith([{ type: 'rescan' }, { type: 'rescan' }, { type: 'rescan' }])
    await runGuards(api, PROFILE_KEY, reading(95), NOW)
    expect(notices()).toEqual([
      'warning:Froze 1 more AI process started by Claude Code (work).',
      'warning:Froze 3 more AI processes started by Claude Code (work).',
    ])
  })

  it('ignores a failing rescan but marks a failing suspend as failed', async () => {
    seed()
    const api = makeApi({ suspend: vi.fn(async () => { throw new Error('boom') }) })
    stepWith([{ type: 'rescan' }, { type: 'notify', level: 'warning', message: 'after rescan' }])
    await runGuards(api, PROFILE_KEY, reading(95), NOW)
    expect(notices()).toEqual(['warning:after rescan'])

    stepWith([{ type: 'suspend' }, { type: 'notify', level: 'info', message: 'never' }])
    await runGuards(api, PROFILE_KEY, reading(95), NOW)
    expect(notices()).toEqual(['warning:after rescan', 'danger:Could not suspend Claude Code (work): Error: boom'])
    expect(getQuotaState().guards[KEY].phase).toBe('active')
  })
})

describe('releaseUnguarded', () => {
  const held: GuardState = { ...INITIAL_GUARD, phase: 'suspended' }

  it('keeps guards that still apply and skips terminals that are not held', async () => {
    seed({
      terminals: [terminal(), terminal({ sessionId: 's2', instanceKey: 's2:1:1' })],
      guards: { [KEY]: held },
    })
    const api = makeApi()
    await releaseUnguarded(api)
    expect(api.resume).not.toHaveBeenCalled()
    expect(getQuotaState().guards[KEY]).toBe(held)
  })

  it.each([
    ['the feature is off', configWith({}, false)],
    ['the agent is off', configWith({ enabled: false })],
    ['suspend is off', configWith({ suspendAtLimit: false })],
  ])('thaws a held terminal when %s', async (_label, config) => {
    seed({ config, guards: { [KEY]: held } })
    const api = makeApi()
    await releaseUnguarded(api)
    expect(api.resume).toHaveBeenCalledWith('s1')
    expect(recoveryMock).toHaveBeenCalledWith('s1', config.agents.claude.resumeRecovery)
    expect(getQuotaState().guards[KEY]).toEqual(INITIAL_GUARD)
    expect(notices()).toEqual(['info:Claude Code (work) resumed: its quota guard was switched off.'])
  })
})

describe('resumeByHand', () => {
  it('does nothing for an unknown session', async () => {
    seed()
    const api = makeApi()
    await resumeByHand(api, 'missing', NOW)
    expect(api.resume).not.toHaveBeenCalled()
  })

  it('pauses monitoring with an override and bypasses until the window resets', async () => {
    const resetsAt = NOW + 60_000
    seed({ guards: { [KEY]: { ...INITIAL_GUARD, phase: 'suspended', resetsAt } } })
    setOverride(KEY, { autoResume: false })
    const api = makeApi()
    await resumeByHand(api, 's1', NOW)
    expect(getQuotaState().overrides[KEY]).toEqual({ enabled: false, suspendAtLimit: false, autoResume: false })
    expect(getQuotaState().guards[KEY]).toMatchObject({ phase: 'active', bypassUntil: resetsAt })
    expect(api.resume).toHaveBeenCalledWith('s1')
    expect(recoveryMock).toHaveBeenCalledTimes(1)
    expect(notices()[0]).toContain('resumed by hand')
  })

  it('bypasses for an hour when the terminal has no guard yet', async () => {
    seed()
    await resumeByHand(makeApi(), 's1', NOW)
    expect(getQuotaState().guards[KEY].bypassUntil).toBe(NOW + 3_600_000)
  })
})

describe('suspendByHand', () => {
  it('returns false for an unknown session', async () => {
    seed()
    await expect(suspendByHand(makeApi(), 'missing')).resolves.toBe(false)
  })

  it('reports a suspend that froze nothing with the first error or a fallback', async () => {
    seed()
    const api = makeApi({
      suspend: vi.fn()
        .mockResolvedValueOnce(report({ errors: ['denied'] }))
        .mockResolvedValueOnce(report()),
    })
    await expect(suspendByHand(api, 's1')).resolves.toBe(false)
    await expect(suspendByHand(api, 's1')).resolves.toBe(false)
    expect(notices()).toEqual([
      'danger:Could not freeze Claude Code (work): denied.',
      'danger:Could not freeze Claude Code (work): no active agent process found.',
    ])
  })

  it('marks one process with one thread as suspended at 100% by default', async () => {
    seed()
    const api = makeApi({ suspend: vi.fn(async () => report({ frozen: [{ pid: 1, startTime: 1, image: 'a', threads: [5] }] })) })
    await expect(suspendByHand(api, 's1')).resolves.toBe(true)
    expect(getQuotaState().guards[KEY]).toMatchObject({ phase: 'suspended', frozenPct: 100 })
    expect(notices()).toEqual(['warning:Frozen 1 process (1 thread) for Claude Code (work).'])
  })

  it('counts threads across processes and keeps a known frozen percentage', async () => {
    seed({ guards: { [KEY]: { ...INITIAL_GUARD, frozenPct: 92 } } })
    const api = makeApi({
      suspend: vi.fn(async () => report({
        frozen: [
          { pid: 1, startTime: 1, image: 'a', threads: [1, 2] },
          { pid: 2, startTime: 2, image: 'b' },
        ],
      })),
    })
    await expect(suspendByHand(api, 's1')).resolves.toBe(true)
    expect(getQuotaState().guards[KEY].frozenPct).toBe(92)
    expect(notices()).toEqual(['warning:Frozen 2 processes (2 threads) for Claude Code (work).'])
  })

  it('reports a thrown suspend', async () => {
    seed()
    const api = makeApi({ suspend: vi.fn(async () => { throw new Error('nope') }) })
    await expect(suspendByHand(api, 's1')).resolves.toBe(false)
    expect(notices()).toEqual(['danger:Could not freeze Claude Code (work): Error: nope'])
  })
})
