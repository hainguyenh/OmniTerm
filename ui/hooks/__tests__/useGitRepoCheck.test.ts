/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkIsGitRepo, clearGitRepoCache, useGitRepoCheck } from '../useGitRepoCheck'

const mockGetStatus = vi.fn()

vi.mock('../../gitAPI', () => ({
  createGitAPI: () => ({
    getStatus: (...args: unknown[]) => mockGetStatus(...args),
  }),
}))

describe('useGitRepoCheck', () => {
  beforeEach(() => {
    clearGitRepoCache()
    mockGetStatus.mockReset()
  })

  it('returns false when cwd is empty or undefined', () => {
    const { result } = renderHook(() => useGitRepoCheck(undefined))
    expect(result.current).toBe(false)
    expect(mockGetStatus).not.toHaveBeenCalled()
  })

  it('returns false when enabled is false', () => {
    const { result } = renderHook(() => useGitRepoCheck('/path/to/repo', false))
    expect(result.current).toBe(false)
    expect(mockGetStatus).not.toHaveBeenCalled()
  })

  it('returns true when getStatus resolves successfully', async () => {
    mockGetStatus.mockResolvedValueOnce({ branch: 'main' })
    const { result } = renderHook(() => useGitRepoCheck('/repo/with/git'))

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current).toBe(true)
    expect(mockGetStatus).toHaveBeenCalledWith('/repo/with/git')
  })

  it('returns false when getStatus rejects', async () => {
    mockGetStatus.mockRejectedValueOnce(new Error('fatal: not a git repository'))
    const { result } = renderHook(() => useGitRepoCheck('/not/a/git/repo'))

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current).toBe(false)
  })

  it('caches positive and negative results', async () => {
    mockGetStatus.mockResolvedValueOnce({ branch: 'main' })
    const first = await checkIsGitRepo('/cached/repo')
    expect(first).toBe(true)
    expect(mockGetStatus).toHaveBeenCalledTimes(1)

    const second = await checkIsGitRepo('/cached/repo')
    expect(second).toBe(true)
    expect(mockGetStatus).toHaveBeenCalledTimes(1)
  })
})
