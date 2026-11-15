/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetQuotaStore, setQuotaNow, updateQuota, useCoarseNow } from '../quotaStore'

beforeEach(() => resetQuotaStore())
afterEach(() => resetQuotaStore())

describe('useCoarseNow', () => {
  it('buckets the clock to 30s without a nearby deadline', () => {
    setQuotaNow(1_000_000_000)
    const { result } = renderHook(() => useCoarseNow())
    expect(result.current).toBe(Math.floor(1_000_000_000 / 30_000) * 30_000)
  })

  it('does not change value (and so does not re-render) within the same 30s bucket', () => {
    setQuotaNow(1_000_000_000)
    const { result, rerender } = renderHook(() => useCoarseNow())
    const first = result.current
    setQuotaNow(1_000_000_000 + 5_000)
    rerender()
    expect(result.current).toBe(first)
  })

  it('switches to a 1s bucket once the given deadline is under two minutes away', () => {
    const now = 1_000_000_000
    setQuotaNow(now)
    const { result } = renderHook(() => useCoarseNow(now + 60_000))
    expect(result.current).toBe(Math.floor(now / 1_000) * 1_000)
  })

  it('does not re-render on quota store updates, only on the clock', () => {
    setQuotaNow(1_000_000_000)
    let renders = 0
    renderHook(() => {
      renders += 1
      return useCoarseNow()
    })
    const before = renders
    act(() => updateQuota((state) => ({ ...state, quickOpen: !state.quickOpen })))
    expect(renders).toBe(before)
    act(() => setQuotaNow(1_000_000_000 + 60_000))
    expect(renders).toBe(before + 1)
  })
})
