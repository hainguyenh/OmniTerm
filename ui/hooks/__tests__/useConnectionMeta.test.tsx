/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useConnectionMeta } from '../useConnectionMeta'

const RECENT_KEY = 'omniterm-recent-conns'
const FAVORITES_KEY = 'omniterm-favorite-conns'

describe('useConnectionMeta', () => {
  beforeEach(() => localStorage.clear())

  it('loads valid saved metadata and ignores malformed JSON', async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['recent']))
    localStorage.setItem(FAVORITES_KEY, '{bad json')
    const { result } = renderHook(() => useConnectionMeta())

    await waitFor(() => expect(result.current.recents).toEqual(['recent']))
    expect(result.current.favorites).toEqual([])
  })

  it('deduplicates recents, keeps newest first, and caps the list at ten', () => {
    const { result } = renderHook(() => useConnectionMeta())
    act(() => {
      for (let index = 0; index < 12; index += 1) result.current.addRecent(`id-${index}`)
      result.current.addRecent('id-5')
    })

    expect(result.current.recents).toHaveLength(10)
    expect(result.current.recents[0]).toBe('id-5')
    expect(new Set(result.current.recents).size).toBe(10)
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual(result.current.recents)
  })

  it('adds and removes favorites while persisting each change', () => {
    const { result } = renderHook(() => useConnectionMeta())
    act(() => result.current.toggleFavorite('server'))
    expect(result.current.favorites).toEqual(['server'])
    act(() => result.current.toggleFavorite('server'))
    expect(result.current.favorites).toEqual([])
    expect(localStorage.getItem(FAVORITES_KEY)).toBe('[]')
  })
})
