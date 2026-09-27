import { describe, expect, it } from 'vitest'

import type { QuotaSnapshot } from '../src/types'
import type { GuardState } from './quotaGuard'

import { DEFAULT_QUOTA_CONFIG } from './quotaConfig'
import { INITIAL_GUARD, isHeld, manualResume, stepGuard, suspendFailed } from './quotaGuard'
import { dueWake, rememberReset, weekSpent } from './wakePolicy'

const NOW = Date.UTC(2026, 8, 25, 3, 0)
const RESET = NOW + 3_600_000
const config = { ...DEFAULT_QUOTA_CONFIG.agents.claude, limits: { session: 80, weekly: 90, monthly: 95 }, guardMinutes: 10 }
const snap = (session: number, at = NOW, extra: Partial<QuotaSnapshot> = {}): QuotaSnapshot => ({
  windows: [
    { kind: 'session', label: 's', usedPct: session, resetsAt: RESET },
    { kind: 'weekly', label: 'w', usedPct: 20, resetsAt: NOW + 5 * 86_400_000 },
  ],
  fetchedAt: at,
  ...extra,
})
const step = (state: GuardState, snapshot: QuotaSnapshot | undefined, now = NOW, overrides = {}) =>
  stepGuard(state, { snapshot, config: { ...config, ...overrides }, now, subject: 'Claude Code (work)' })
const types = (result: ReturnType<typeof step>) => result.actions.map((action) => action.type)

describe('stepGuard: active', () => {
  it('does nothing under the limit or on untrusted readings', () => {
    expect(step(INITIAL_GUARD, snap(50)).actions).toEqual([])
    expect(step(INITIAL_GUARD, snap(95, NOW, { error: 'parse_failed' })).actions).toEqual([])
    expect(step(INITIAL_GUARD, snap(95, NOW - 3_600_000)).actions).toEqual([])
  })

  it('suspends at the limit and starts guarding', () => {
    const result = step(INITIAL_GUARD, snap(81))
    expect(types(result)).toEqual(['suspend', 'notify'])
    expect(result.actions[1]).toMatchObject({ level: 'warning', message: 'Claude Code (work) suspended: 81% ≥ 80% session limit.' })
    expect(result.state).toMatchObject({ phase: 'guarding', window: 'session', frozenPct: 81, resetsAt: RESET, guardUntil: NOW + 600_000 })
    expect(isHeld(result.state)).toBe(true)
  })

  it('only warns, once per window, when suspend is off', () => {
    const first = step(INITIAL_GUARD, snap(85), NOW, { suspendAtLimit: false })
    expect(first.actions).toEqual([expect.objectContaining({ type: 'notify', level: 'danger' })])
    expect(step(first.state, snap(86), NOW, { suspendAtLimit: false }).actions).toEqual([])
  })

  it('backs off after a failed attempt and honours a manual resume', () => {
    const failed = suspendFailed({ ...INITIAL_GUARD, lastAttemptAt: NOW, notifiedKey: 'k' })
    expect(failed).toEqual({ ...INITIAL_GUARD, lastAttemptAt: NOW, notifiedKey: 'k' })
    expect(step(failed, snap(90), NOW + 10_000).actions).toEqual([])
    expect(types(step(failed, snap(90), NOW + 31_000))).toContain('suspend')
    const bypass = manualResume({ ...INITIAL_GUARD, resetsAt: RESET }, NOW)
    expect(bypass.bypassUntil).toBe(RESET)
    expect(step(bypass, snap(90)).actions).toEqual([])
    expect(manualResume(INITIAL_GUARD, NOW).bypassUntil).toBe(NOW + 3_600_000)
  })
})

describe('stepGuard: held', () => {
  const guarding = step(INITIAL_GUARD, snap(81)).state

  it('re-scans for new sub-agents on every guarding step, even without data', () => {
    expect(types(step(guarding, snap(81, NOW + 15_000), NOW + 15_000))).toEqual(['rescan'])
    expect(types(step(guarding, undefined, NOW + 15_000))).toEqual(['rescan'])
  })

  it('alarms after two rising readings and restarts the watch', () => {
    const one = step(guarding, snap(82, NOW + 15_000), NOW + 15_000)
    expect(one.state.risingCount).toBe(1)
    const two = step(one.state, snap(83, NOW + 30_000), NOW + 30_000)
    expect(types(two)).toEqual(['rescan', 'notify'])
    expect(two.actions[1]).toMatchObject({ level: 'danger', message: expect.stringContaining('81% → 83%') })
    expect(two.state).toMatchObject({ risingCount: 0, guardUntil: NOW + 30_000 + 600_000 })
    expect(step(one.state, snap(82, NOW + 30_000), NOW + 30_000).state.risingCount).toBe(0)
  })

  it('stops the agent when it keeps climbing past the hard stop', () => {
    const one = step(guarding, snap(85, NOW + 15_000), NOW + 15_000, { hardStopAtPct: 85 })
    const two = step(one.state, snap(86, NOW + 30_000), NOW + 30_000, { hardStopAtPct: 85 })
    expect(types(two)).toEqual(['rescan', 'notify', 'terminate', 'notify'])
    expect(two.state.phase).toBe('stopped')
    expect(step(two.state, snap(99)).actions).toEqual([])
  })

  it('settles into suspended once the guard window passes quietly', () => {
    const later = NOW + 601_000
    expect(step(guarding, snap(81, later), later).state.phase).toBe('suspended')
    expect(step(guarding, undefined, later).state.phase).toBe('suspended')
    const suspended = step(guarding, snap(81, later), later).state
    expect(types(step(suspended, snap(81, later + 1000), later + 1000))).toEqual([])
  })

  it('resumes after the reset plus delay once every window is under its limit', () => {
    const suspended: GuardState = { ...guarding, phase: 'suspended' }
    const early = RESET + 60_000
    expect(step(suspended, { ...snap(5, early), windows: [{ kind: 'session', label: 's', usedPct: 60, resetsAt: RESET + 5 * 3_600_000 }] }, early).actions).toEqual([])
    const due = RESET + 3 * 60_000
    const next = step(suspended, { ...snap(60, due), windows: [{ kind: 'session', label: 's', usedPct: 60, resetsAt: RESET + 5 * 3_600_000 }] }, due)
    expect(types(next)).toEqual(['resume', 'notify'])
    expect(next.state).toEqual(INITIAL_GUARD)
  })

  it('keeps the original reset time once it has passed', () => {
    const suspended: GuardState = { ...guarding, phase: 'suspended' }
    const after = RESET + 60_000
    const moved = { ...snap(85, after), windows: [{ kind: 'session' as const, label: 's', usedPct: 85, resetsAt: RESET + 5 * 3_600_000 }] }
    expect(step(suspended, moved, after).state.resetsAt).toBe(RESET)
    const before = { ...snap(85), windows: [{ kind: 'session' as const, label: 's', usedPct: 85, resetsAt: RESET + 60_000 }] }
    expect(step(suspended, before).state.resetsAt).toBe(RESET + 60_000)
  })

  it('resumes on an early reset, unless auto-resume is off', () => {
    expect(types(step(guarding, snap(10, NOW + 15_000), NOW + 15_000))).toEqual(['resume', 'notify'])
    expect(types(step(guarding, snap(10, NOW + 15_000), NOW + 15_000, { autoResume: false }))).toEqual(['rescan'])
  })

  it('resumes without a reset time once the reading is under the limit', () => {
    const held: GuardState = { ...guarding, phase: 'suspended', resetsAt: undefined, frozenPct: 60 }
    const reading: QuotaSnapshot = { windows: [{ kind: 'session', label: 's', usedPct: 50 }], fetchedAt: NOW }
    expect(types(step(held, reading))).toEqual(['resume', 'notify'])
    const noWindow: GuardState = { ...held, window: undefined }
    expect(step(noWindow, reading).actions).toEqual([])
  })
})

describe('wake policy', () => {
  const wakeConfig = (mode: 'off' | 'timeOfDay' | 'afterReset', extra = {}) => ({ ...config, wake: { ...config.wake, mode, time: '06:00', delayMinutes: 2, ...extra } })

  it('anchors afterReset to the remembered reset and fires once in its window', () => {
    const memory = rememberReset({}, snap(10), 2, NOW)
    expect(memory.sessionReset).toBe(RESET)
    const cfg = wakeConfig('afterReset')
    expect(dueWake(cfg, memory, snap(10), RESET + 60_000)).toBeNull()
    expect(dueWake(cfg, memory, snap(10), RESET + 3 * 60_000)).toBe(`reset:${RESET}`)
    expect(dueWake(cfg, { ...memory, lastKey: `reset:${RESET}` }, snap(10), RESET + 3 * 60_000)).toBeNull()
    expect(dueWake(cfg, memory, snap(10), RESET + 8 * 60_000)).toBeNull()
    expect(dueWake(cfg, {}, snap(10), NOW)).toBeNull()
  })

  it('keeps a passed reset until its wake window is over', () => {
    const memory = { sessionReset: RESET }
    const nextWindow = { ...snap(1), windows: [{ kind: 'session' as const, label: 's', usedPct: 1, resetsAt: RESET + 5 * 3_600_000 }] }
    expect(rememberReset(memory, nextWindow, 2, RESET + 60_000)).toBe(memory)
    expect(rememberReset(memory, nextWindow, 2, RESET + 10 * 60_000).sessionReset).toBe(RESET + 5 * 3_600_000)
    expect(rememberReset(memory, snap(1), 2, NOW)).toBe(memory)
    expect(rememberReset(memory, undefined, 2, NOW)).toBe(memory)
  })

  it('fires timeOfDay once per local day', () => {
    const today = new Date(NOW)
    const six = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 6, 0).getTime()
    const cfg = wakeConfig('timeOfDay')
    const key = dueWake(cfg, {}, snap(1), six + 60_000)
    expect(key).toMatch(/^day:/)
    expect(dueWake(cfg, { lastKey: key ?? '' }, snap(1), six + 90_000)).toBeNull()
    expect(dueWake(cfg, {}, snap(1), six - 60_000)).toBeNull()
  })

  it('skips when off or when the week is spent, even for a suspended profile', () => {
    expect(dueWake(wakeConfig('off'), { sessionReset: NOW }, snap(1), NOW + 3 * 60_000)).toBeNull()
    const spent = { ...snap(1), windows: [{ kind: 'weekly' as const, label: 'w', usedPct: 95 }] }
    expect(weekSpent(spent, config)).toBe(true)
    expect(weekSpent(undefined, config)).toBe(false)
    expect(dueWake(wakeConfig('afterReset'), { sessionReset: NOW }, spent, NOW + 3 * 60_000)).toBeNull()
  })
})
