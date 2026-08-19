/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockOmnitermAPI } from '../../testUtils'
import { useWindowRounding } from '../useWindowRounding'

describe('useWindowRounding', () => {
  beforeEach(() => {
    mockOmnitermAPI()
  })

  it('rounds a restored Windows window', () => {
    const { result } = renderHook(() => useWindowRounding())
    expect(result.current).toBe(true)
  })

  it('keeps the shell square while a Windows window is maximized', async () => {
    mockOmnitermAPI({ windowControl: { isMaximized: vi.fn(async () => true) } })
    const { result } = renderHook(() => useWindowRounding())
    await act(async () => {})
    expect(result.current).toBe(false)
  })

  it('turns the shell square while the maximized-state event reports maximized', async () => {
    let notify: ((state: boolean) => void) | null = null
    mockOmnitermAPI({
      windowControl: {
        isMaximized: vi.fn(async () => false),
        onMaximizedState: vi.fn((cb: (state: boolean) => void) => { notify = cb; return vi.fn() }),
      },
    })
    const { result } = renderHook(() => useWindowRounding())
    await act(async () => {})
    expect(result.current).toBe(true)
    act(() => notify?.(true))
    expect(result.current).toBe(false)
    act(() => notify?.(false))
    expect(result.current).toBe(true)
  })

  it('never rounds on non-Windows platforms, without querying the window', () => {
    const isMaximized = vi.fn(async () => false)
    mockOmnitermAPI({ app: { platform: 'linux' }, windowControl: { isMaximized } })
    const { result } = renderHook(() => useWindowRounding())
    expect(result.current).toBe(false)
    expect(isMaximized).not.toHaveBeenCalled()
  })

  it('unsubscribes from the maximized-state event on unmount', () => {
    const stop = vi.fn()
    mockOmnitermAPI({ windowControl: { onMaximizedState: vi.fn(() => stop) } })
    const { unmount } = renderHook(() => useWindowRounding())
    unmount()
    expect(stop).toHaveBeenCalled()
  })
})