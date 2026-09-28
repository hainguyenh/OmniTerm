/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { updateQuota, useCoarseNow, resetQuotaStore } from '../quotaStore'

beforeEach(() => resetQuotaStore())
afterEach(() => resetQuotaStore())

describe('useCoarseNow', () => {
  it('buckets the clock to 30s without a nearby deadline', () => {
    updateQuota((state) => ({ ...state, now: 1_000_000_000 }))
    const { result } = renderHook(() => useCoarseNow())
    expect(result.current).toBe(Math.floor(1_000_000_000 / 30_000) * 30_000)
  })

  it('does not change value (and so does not re-render) within the same 30s bucket', () => {
    updateQuota((state) => ({ ...state, now: 1_000_000_000 }))
    const { result, rerender } = renderHook(() => useCoarseNow())
    const first = result.current
    updateQuota((state) => ({ ...state, now: 1_000_000_000 + 5_000 }))
    rerender()
    expect(result.current).toBe(first)
  })

  it('switches to a 1s bucket once the given deadline is under two minutes away', () => {
    const now = 1_000_000_000
    updateQuota((state) => ({ ...state, now }))
    const { result } = renderHook(() => useCoarseNow(now + 60_000))
    expect(result.current).toBe(Math.floor(now / 1_000) * 1_000)
  })
})
