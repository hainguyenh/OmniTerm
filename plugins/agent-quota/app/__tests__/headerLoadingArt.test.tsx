/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HEADER_LOADING_ART, resetPaceArtForTests, resolvePaceArt, usePaceCustomArt } from '../headerLoadingArt'

beforeEach(() => {
  resetPaceArtForTests()
})

describe('pace artwork', () => {
  it('prefers the upload for a slot and falls back to the built-in GIF', () => {
    const map = {
      slow: { light: null, dark: null },
      onTrack: { light: null, dark: 'blob:mine' },
      fast: { light: null, dark: null },
      overshooting: { light: null, dark: null },
    }
    expect(resolvePaceArt('onTrack', 'dark', map)).toBe('blob:mine')
    expect(resolvePaceArt('onTrack', 'light', map)).toBe(HEADER_LOADING_ART.onTrack.light)
    expect(resolvePaceArt('fast', 'dark')).toBe(HEADER_LOADING_ART.fast.dark)
  })

  it('reads the eight slots once for every header in the window, and shares uploads', async () => {
    const get = vi.fn(async (slot: string) => (slot === 'pace-fast-dark' ? 'blob:fast' : null))
    window.omnitermAPI = { customArt: { get } } as unknown as typeof window.omnitermAPI

    const first = renderHook(() => usePaceCustomArt())
    const second = renderHook(() => usePaceCustomArt())
    await waitFor(() => expect(first.result.current.paceArt.fast.dark).toBe('blob:fast'))

    expect(second.result.current.paceArt.fast.dark).toBe('blob:fast')
    expect(get).toHaveBeenCalledTimes(8)
  })
})
