/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { checkIsGitRepo, clearGitRepoCache, useGitRepoCheck } from '../useGitRepoCheck'

const mockGetStatus = vi.fn()

vi.mock('../../gitAPI', () => ({
  createGitAPI: () => ({
    getStatus: (...args: unknown[]) => mockGetStatus(...args),
  }),
}))

describe('useGitRepoCheck coverage', () => {
  beforeEach(() => {
    clearGitRepoCache()
    mockGetStatus.mockReset()
    mockGetStatus.mockResolvedValue({})
  })

  it('treats a blank or separator-only path as not a repository without asking git', async () => {
    await expect(checkIsGitRepo('   ')).resolves.toBe(false)
    await expect(checkIsGitRepo('///')).resolves.toBe(false)
    expect(mockGetStatus).not.toHaveBeenCalled()
  })

  it('normalizes Windows separators and trailing slashes before asking and caching', async () => {
    mockGetStatus.mockResolvedValue({})
    await expect(checkIsGitRepo(' C:\\work\\repo\\ ')).resolves.toBe(true)
    await expect(checkIsGitRepo('C:/work/repo')).resolves.toBe(true)
    expect(mockGetStatus).toHaveBeenCalledTimes(1)
    expect(mockGetStatus).toHaveBeenCalledWith('C:/work/repo')
  })

  it('caches a negative result too', async () => {
    mockGetStatus.mockRejectedValue(new Error('not a repo'))
    await expect(checkIsGitRepo('/plain')).resolves.toBe(false)
    await expect(checkIsGitRepo('/plain/')).resolves.toBe(false)
    expect(mockGetStatus).toHaveBeenCalledTimes(1)
  })

  it('starts from the cached answer on first render', async () => {
    mockGetStatus.mockResolvedValue({})
    await checkIsGitRepo('/cached')
    const { result } = renderHook(() => useGitRepoCheck('\\cached\\'))
    expect(result.current).toBe(true)
  })

  it('re-checks on a git refresh event, dropping the stale cache entry', async () => {
    mockGetStatus.mockResolvedValueOnce({})
    const { result } = renderHook(() => useGitRepoCheck('/repo'))
    await waitFor(() => expect(result.current).toBe(true))

    mockGetStatus.mockRejectedValueOnce(new Error('removed'))
    act(() => { window.dispatchEvent(new Event('omniterm:git-refresh')) })
    await waitFor(() => expect(result.current).toBe(false))
    expect(mockGetStatus).toHaveBeenCalledTimes(2)
  })

  it('resets to false when disabled and ignores answers after unmount', async () => {
    mockGetStatus.mockResolvedValueOnce({})
    const { result, rerender } = renderHook(({ enabled }) => useGitRepoCheck('/toggle', enabled), {
      initialProps: { enabled: true },
    })
    await waitFor(() => expect(result.current).toBe(true))
    rerender({ enabled: false })
    expect(result.current).toBe(false)

    let resolve: (value: unknown) => void = () => {}
    mockGetStatus.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const late = renderHook(() => useGitRepoCheck('/late'))
    late.unmount()
    await act(async () => { resolve({}) })
    expect(late.result.current).toBe(false)

    const listeners = vi.spyOn(window, 'removeEventListener')
    const other = renderHook(() => useGitRepoCheck('/other'))
    other.unmount()
    expect(listeners).toHaveBeenCalledWith('omniterm:git-refresh', expect.any(Function))
    listeners.mockRestore()
  })
})
