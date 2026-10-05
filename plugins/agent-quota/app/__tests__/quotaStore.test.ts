/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_QUOTA_CONFIG } from '../quotaConfig'
import {
  clearAllManualPauses,
  clearManualPause,
  clearOverrides,
  dismissNotice,
  getQuotaState,
  pushNotice,
  registerQuotaCommands,
  requestConfirm,
  resetQuotaStore,
  setEditing,
  setOverride,
  setQuickOpen,
  setReviewSession,
  terminalConfig,
  updateQuota,
  useQuota,
} from '../quotaStore'
import { terminal } from './quotaFixtures'

describe('quotaStore', () => {
  it('handles setQuickOpen, setEditing, and setReviewSession idempotently', () => {
    resetQuotaStore()
    const { result: openResult } = renderHook(() => useQuota((state) => state.quickOpen))
    const { result: editResult } = renderHook(() => useQuota((state) => state.editing))
    const { result: reviewResult } = renderHook(() => useQuota((state) => state.reviewSessionId))

    expect(openResult.current).toBe(false)
    act(() => setQuickOpen(true))
    expect(openResult.current).toBe(true)
    act(() => setQuickOpen(true))
    expect(openResult.current).toBe(true)

    expect(editResult.current).toBeNull()
    act(() => setEditing('session-1'))
    expect(editResult.current).toBe('session-1')
    act(() => setEditing('session-1'))
    expect(editResult.current).toBe('session-1')

    expect(reviewResult.current).toBeNull()
    act(() => setReviewSession('session-2'))
    expect(reviewResult.current).toBe('session-2')
    act(() => setReviewSession('session-2'))
    expect(reviewResult.current).toBe('session-2')
  })

  it('manages overrides and clearOverrides correctly', () => {
    resetQuotaStore()
    const { result } = renderHook(() => useQuota((state) => state.overrides))

    // Non-existent key with null is a no-op
    act(() => setOverride('inst-none', null))
    expect(result.current).toEqual({})

    // Set override
    act(() => setOverride('inst-1', { enabled: true }))
    expect(result.current['inst-1']).toEqual({ enabled: true })

    // Set second override
    act(() => setOverride('inst-2', { enabled: false }))
    expect(Object.keys(result.current)).toHaveLength(2)

    // Remove single override with null
    act(() => setOverride('inst-1', null))
    expect(result.current['inst-1']).toBeUndefined()
    expect(result.current['inst-2']).toBeDefined()

    // Clear all overrides
    act(() => clearOverrides())
    expect(result.current).toEqual({})

    // Calling clearOverrides when already empty is a no-op
    act(() => clearOverrides())
    expect(result.current).toEqual({})
  })

  it('handles pushNotice, MAX_NOTICES clamping, and dismissNotice', () => {
    resetQuotaStore()
    const { result } = renderHook(() => useQuota((state) => state.notices))

    expect(result.current).toEqual([])

    act(() => pushNotice('info', 'notice 1'))
    act(() => pushNotice('warning', 'notice 2'))
    act(() => pushNotice('danger', 'notice 3'))
    act(() => pushNotice('info', 'notice 4'))
    act(() => pushNotice('warning', 'notice 5'))

    // MAX_NOTICES is 4, so notice 1 was trimmed
    expect(result.current).toHaveLength(4)
    expect(result.current.map((n) => n.message)).toEqual(['notice 2', 'notice 3', 'notice 4', 'notice 5'])

    const targetId = result.current[0].id
    act(() => dismissNotice(targetId))
    expect(result.current).toHaveLength(3)
    expect(result.current.some((n) => n.id === targetId)).toBe(false)
  })

  it('manages requestConfirm and clearManualPause', () => {
    resetQuotaStore()
    const { result: confirmResult } = renderHook(() => useQuota((state) => state.confirm))

    expect(confirmResult.current).toBeNull()
    act(() => requestConfirm({
      title: 'Confirm',
      message: 'Sure?',
      confirmLabel: 'Yes',
      onConfirm: vi.fn(),
    }))
    expect(confirmResult.current?.title).toBe('Confirm')
    act(() => requestConfirm(null))
    expect(confirmResult.current).toBeNull()

    // clearManualPause with no guard or no bypassUntil is no-op
    act(() => clearManualPause('missing-key'))

    // clearManualPause with active bypass and pause overrides clears both
    act(() => {
      updateQuota((current) => ({
        ...current,
        guards: {
          'k1': {
            phase: 'active',
            lastAttemptAt: 100,
            risingCount: 0,
            bypassUntil: 123456,
          },
        },
        overrides: {
          'k1': { enabled: false, suspendAtLimit: false },
          'k2': { enabled: false, suspendAtLimit: false, limits: { session: 80 } },
        },
      }))
    })
    act(() => clearManualPause('k1'))

    const { result: guardsResult } = renderHook(() => useQuota((state) => state.guards))
    expect(guardsResult.current['k1']?.bypassUntil).toBeUndefined()
    expect(getQuotaState().overrides['k1']).toBeUndefined()

    act(() => clearManualPause('k2'))
    expect(getQuotaState().overrides['k2']).toEqual({ limits: { session: 80 } })
  })

  it('clearAllManualPauses clears pauses for all or specific agents', () => {
    resetQuotaStore()
    act(() => {
      updateQuota((current) => ({
        ...current,
        terminals: {
          s1: terminal({ sessionId: 's1', instanceKey: 'k-claude', agent: 'claude' }),
          s2: terminal({ sessionId: 's2', instanceKey: 'k-agy', agent: 'agy' }),
        },
        guards: {
          'k-claude': { phase: 'active', lastAttemptAt: 100, risingCount: 0, bypassUntil: 9999 },
          'k-agy': { phase: 'active', lastAttemptAt: 100, risingCount: 0, bypassUntil: 9999 },
        },
        overrides: {
          'k-claude': { enabled: false, suspendAtLimit: false },
          'k-agy': { enabled: false, suspendAtLimit: false },
        },
      }))
    })

    // Filtered to agy: only agy is cleared
    act(() => clearAllManualPauses('agy'))
    expect(getQuotaState().guards['k-agy']?.bypassUntil).toBeUndefined()
    expect(getQuotaState().overrides['k-agy']).toBeUndefined()
    expect(getQuotaState().guards['k-claude']?.bypassUntil).toBe(9999)
    expect(getQuotaState().overrides['k-claude']).toBeDefined()

    // Global clear: remaining claude is cleared
    act(() => clearAllManualPauses())
    expect(getQuotaState().guards['k-claude']?.bypassUntil).toBeUndefined()
    expect(getQuotaState().overrides['k-claude']).toBeUndefined()
  })

  it('computes terminalConfig with effective overrides', () => {
    const term = terminal({ instanceKey: 'claude:work' })

    const state = {
      config: DEFAULT_QUOTA_CONFIG,
      overrides: {
        'claude:work': { limits: { session: 50, weekly: 60, monthly: 70 } },
      },
    } as unknown as Parameters<typeof terminalConfig>[0]

    const config = terminalConfig(state, term)
    expect(config.limits.session).toBe(50)
  })

  it('registers quota commands', () => {
    resetQuotaStore()
    const mockSave = vi.fn()
    registerQuotaCommands({ saveConfig: mockSave })
  })
})
