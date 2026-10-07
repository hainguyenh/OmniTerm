/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useGitFavorites } from '../useGitFavorites'

describe('useGitFavorites', () => {
  const repoA = 'D:/workspace/RepoA'
  const repoB = 'D:\\workspace\\RepoB'

  beforeEach(() => {
    localStorage.clear()
  })

  it('loads valid saved favorites and falls back on empty or malformed JSON', () => {
    localStorage.setItem('omniterm:git-favorites:d:/workspace/repoa', JSON.stringify(['feature/x', 'main']))
    const { result } = renderHook(() => useGitFavorites(repoA))
    expect(result.current.favorites).toEqual(['feature/x', 'main'])
    expect(result.current.isFavorite('main')).toBe(true)
    expect(result.current.isFavorite('feature/y')).toBe(false)

    localStorage.setItem('omniterm:git-favorites:d:/workspace/repoa', '{bad json')
    const { result: malformed } = renderHook(() => useGitFavorites(repoA))
    expect(malformed.current.favorites).toEqual([])
  })

  it('toggles favorites and persists changes per repository', () => {
    const { result } = renderHook(() => useGitFavorites(repoA))
    expect(result.current.favorites).toEqual([])

    act(() => {
      result.current.toggleFavorite('main')
    })
    expect(result.current.favorites).toEqual(['main'])
    expect(result.current.isFavorite('main')).toBe(true)
    expect(JSON.parse(localStorage.getItem('omniterm:git-favorites:d:/workspace/repoa') ?? '[]')).toEqual(['main'])

    act(() => {
      result.current.toggleFavorite('feature/a')
    })
    expect(result.current.favorites).toEqual(['main', 'feature/a'])

    act(() => {
      result.current.toggleFavorite('main')
    })
    expect(result.current.favorites).toEqual(['feature/a'])
    expect(result.current.isFavorite('main')).toBe(false)
  })

  it('isolates favorites between different repositories', () => {
    const { result: hookA } = renderHook(() => useGitFavorites(repoA))
    const { result: hookB } = renderHook(() => useGitFavorites(repoB))

    act(() => {
      hookA.current.toggleFavorite('branch-a')
      hookB.current.toggleFavorite('branch-b')
    })

    expect(hookA.current.favorites).toEqual(['branch-a'])
    expect(hookB.current.favorites).toEqual(['branch-b'])
  })

  it('syncs state on custom event dispatched from another component', () => {
    const { result } = renderHook(() => useGitFavorites(repoA))
    expect(result.current.favorites).toEqual([])

    act(() => {
      localStorage.setItem('omniterm:git-favorites:d:/workspace/repoa', JSON.stringify(['shared']))
      window.dispatchEvent(new CustomEvent('omniterm:git-favorites-changed', { detail: { cwd: repoA } }))
    })

    expect(result.current.favorites).toEqual(['shared'])
  })
})
