/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import type { FormEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitBranchInfo } from '../gitTypes'
import { useGitBranchOps } from '../useGitBranchOps'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}))

const main: GitBranchInfo = {
  name: 'main',
  is_current: true,
  is_remote: false,
  ahead: 0,
  behind: 0,
  is_gone: false,
}

function formEvent() {
  const preventDefault = vi.fn()
  return { event: { preventDefault } as unknown as FormEvent, preventDefault }
}

async function mountHook(onBranchSwitched?: () => void) {
  const onClose = vi.fn()
  const hook = renderHook(() => useGitBranchOps({ cwd: '/repo', onClose, onBranchSwitched }))
  await waitFor(() => expect(hook.result.current.branches).toEqual([main]))
  return { ...hook, onClose }
}

describe('useGitBranchOps outcomes', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'git_branches' ? [main] : ''))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('falls back to default notices when git prints nothing', async () => {
    const onBranchSwitched = vi.fn()
    const { result } = await mountHook(onBranchSwitched)

    await act(async () => { await result.current.handleUpdateProject() })
    expect(result.current.actionNotice).toEqual({ text: 'Update complete', isError: false })
    await act(async () => { await result.current.handleFetch() })
    expect(result.current.actionNotice?.text).toBe('Fetch complete')
    expect(mockInvoke).toHaveBeenCalledWith('git_fetch', { cwd: '/repo', prune: true })
    await act(async () => { await result.current.handlePush() })
    expect(result.current.actionNotice?.text).toBe('Push complete')
    await act(async () => { await result.current.handleMerge('topic') })
    expect(result.current.actionNotice?.text).toBe("Merged 'topic'")
    await act(async () => { await result.current.handleRebase('topic') })
    expect(result.current.actionNotice?.text).toBe("Rebased onto 'topic'")
    expect(onBranchSwitched).toHaveBeenCalledTimes(3)
    expect(result.current.busyAction).toBeNull()
  })

  it('prefers the git output as the notice text', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'git_branches' ? [main] : `${cmd} output`))
    const { result } = await mountHook()

    await act(async () => { await result.current.handleUpdateProject() })
    expect(result.current.actionNotice?.text).toBe('git_pull output')
    await act(async () => { await result.current.handleMerge('topic') })
    expect(result.current.actionNotice?.text).toBe('git_merge output')
    await act(async () => { await result.current.handleRebase('topic') })
    expect(result.current.actionNotice?.text).toBe('git_rebase output')
    await act(async () => { await result.current.handleFetch() })
    expect(result.current.actionNotice?.text).toBe('git_fetch output')
  })

  it('reports every failure as an error notice without switching branches', async () => {
    const onBranchSwitched = vi.fn()
    const { result, onClose } = await mountHook(onBranchSwitched)
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'git_branches') return [main]
      throw new Error(`${cmd} refused`)
    })

    const cases: Array<[() => Promise<void>, string]> = [
      [() => result.current.handleUpdateProject(), 'Update failed: Error: git_pull refused'],
      [() => result.current.handleFetch(), 'Fetch failed: Error: git_fetch refused'],
      [() => result.current.handlePush(), 'Push failed: Error: git_push refused'],
      [() => result.current.handleCheckout('topic'), 'Checkout failed: Error: git_checkout refused'],
      [() => result.current.handleMerge('topic'), 'Merge failed: Error: git_merge refused'],
      [() => result.current.handleRebase('topic'), 'Rebase failed: Error: git_rebase refused'],
      [() => result.current.handleInitRepo(), 'Init failed: Error: git_init refused'],
    ]
    for (const [run, text] of cases) {
      await act(async () => { await run() })
      expect(result.current.actionNotice).toEqual({ text, isError: true })
      expect(result.current.busyAction).toBeNull()
    }
    expect(onBranchSwitched).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('checks out a branch, then closes without a switch callback', async () => {
    const { result, onClose } = await mountHook()
    await act(async () => { await result.current.handleCheckout('topic') })
    expect(result.current.actionNotice?.text).toBe("Switched to branch 'topic'")
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores a blank branch name and creates a trimmed branch from the start point', async () => {
    const onBranchSwitched = vi.fn()
    const { result, onClose } = await mountHook(onBranchSwitched)

    const blank = formEvent()
    act(() => { result.current.setNewBranchName('   ') })
    await act(async () => { await result.current.handleCreateBranch(blank.event) })
    expect(blank.preventDefault).toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalledWith('git_create_branch', expect.anything())

    act(() => {
      result.current.setCreatingBranch(true)
      result.current.setStartPoint('main')
      result.current.setNewBranchName(' feature/x ')
    })
    await act(async () => { await result.current.handleCreateBranch(formEvent().event) })
    expect(mockInvoke).toHaveBeenCalledWith('git_create_branch', { cwd: '/repo', name: 'feature/x', startPoint: 'main', checkout: true })
    expect(result.current.newBranchName).toBe('')
    expect(result.current.creatingBranch).toBe(false)
    expect(onBranchSwitched).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the create form open when git refuses the new branch', async () => {
    const { result, onClose } = await mountHook()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'git_branches') return [main]
      throw new Error('already exists')
    })

    act(() => {
      result.current.setCreatingBranch(true)
      result.current.setNewBranchName('main')
    })
    await act(async () => { await result.current.handleCreateBranch(formEvent().event) })
    expect(result.current.actionNotice).toEqual({ text: 'Create branch failed: Error: already exists', isError: true })
    expect(result.current.creatingBranch).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('flags a missing repository and clears the flag after init', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'git_branches') throw new Error('not a git repository')
      return ''
    })
    const onBranchSwitched = vi.fn()
    const { result } = renderHook(() => useGitBranchOps({ cwd: '/repo', onClose: vi.fn(), onBranchSwitched }))
    await waitFor(() => expect(result.current.notRepo).toBe(true))
    expect(result.current.loading).toBe(false)

    mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'git_branches' ? [main] : ''))
    await act(async () => { await result.current.handleInitRepo() })
    expect(result.current.actionNotice?.text).toBe('Initialized empty Git repository')
    await waitFor(() => expect(result.current.branches).toEqual([main]))
    expect(result.current.notRepo).toBe(false)
    expect(onBranchSwitched).toHaveBeenCalledTimes(1)
  })

  it('initializes without a switch callback', async () => {
    const { result } = await mountHook()
    await act(async () => { await result.current.handleInitRepo() })
    expect(mockInvoke).toHaveBeenCalledWith('git_init', { cwd: '/repo' })
  })

  it('refreshes the Git view after a branch tool succeeds and dismisses the notice later', async () => {
    const { result } = await mountHook()
    const onRefresh = vi.fn()
    window.addEventListener('omniterm:git-refresh', onRefresh)
    vi.useFakeTimers()

    mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'git_branches' ? [main] : 'Upstream set'))
    let failure: string | null = 'pending'
    await act(async () => { failure = await result.current.handleSetUpstream('main', 'origin/main') })
    expect(failure).toBeNull()
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(result.current.actionNotice?.text).toBe('Upstream set')

    act(() => { vi.advanceTimersByTime(4000) })
    expect(result.current.actionNotice).toBeNull()
    window.removeEventListener('omniterm:git-refresh', onRefresh)
  })
})
