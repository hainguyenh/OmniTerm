/** @vitest-environment jsdom */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitBranchDeleteDialog } from '../GitBranchDeleteDialog'
import type { GitBranchInfo, GitDeleteBranchesResult, GitWorktreeInfo } from '../gitTypes'
import { useGitBranchOps } from '../useGitBranchOps'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}))

const branch = (name: string, extra: Partial<GitBranchInfo> = {}): GitBranchInfo => ({
  name,
  is_current: false,
  is_remote: false,
  ahead: 0,
  behind: 0,
  is_gone: false,
  ...extra,
})

const worktree = (path: string, extra: Partial<GitWorktreeInfo> = {}): GitWorktreeInfo => ({
  path,
  is_main: false,
  is_current: false,
  is_detached: false,
  is_bare: false,
  is_locked: false,
  is_prunable: false,
  ...extra,
})

describe('GitBranchDeleteDialog', () => {
  it('names the worktree that goes with the branch and confirms a safe delete', () => {
    const onConfirm = vi.fn()
    render(<GitBranchDeleteDialog pending={{ branch: 'claude/agent', worktreePath: 'D:/repo/.claude/worktrees/agent' }} busy={false} onConfirm={onConfirm} onClose={vi.fn()} />)

    expect(screen.getByRole('note')).toHaveTextContent('D:/repo/.claude/worktrees/agent')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('shows a refusal and offers to force the delete', () => {
    const onConfirm = vi.fn()
    render(<GitBranchDeleteDialog pending={{ branch: 'topic', error: "The branch 'topic' is not fully merged" }} busy={false} onConfirm={onConfirm} onClose={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('not fully merged')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Force delete' }))
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('closes on Escape, the close button and the backdrop, and locks while busy', () => {
    const onClose = vi.fn()
    render(<GitBranchDeleteDialog pending={{ branch: 'topic' }} busy onConfirm={vi.fn()} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Delete topic' })

    fireEvent.click(dialog)
    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(dialog.parentElement as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Close delete dialog' }))
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('restores focus to the opener when it unmounts', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<GitBranchDeleteDialog pending={{ branch: 'topic' }} busy={false} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(opener).not.toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})

describe('useGitBranchOps delete and pull', () => {
  let worktrees: GitWorktreeInfo[] | Error
  let deletes: GitDeleteBranchesResult[]

  beforeEach(() => {
    worktrees = []
    deletes = []
    mockInvoke.mockReset()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'git_branches') return [branch('main', { is_current: true, upstream: 'origin/main' }), branch('topic'), branch('claude/agent')]
      if (cmd === 'git_worktrees') {
        if (worktrees instanceof Error) throw worktrees
        return worktrees
      }
      if (cmd === 'git_delete_branches') return deletes.shift() ?? { deleted: [], failed: [] }
      return 'ok'
    })
  })

  const renderOps = async () => {
    const view = renderHook(() => useGitBranchOps({ cwd: 'C:/repo', currentBranch: 'main', onClose: vi.fn() }))
    await waitFor(() => expect(view.result.current.branches).toHaveLength(3))
    return view.result
  }

  it('deletes a plain branch right away and reports it', async () => {
    deletes = [{ deleted: ['topic'], failed: [] }]
    const refresh = vi.fn()
    window.addEventListener('omniterm:git-refresh', refresh)
    const result = await renderOps()

    await act(async () => { await result.current.handleDeleteBranch('topic') })
    expect(mockInvoke).toHaveBeenCalledWith('git_delete_branches', { cwd: 'C:/repo', branches: ['topic'], force: false, removeWorktrees: false })
    expect(result.current.pendingDelete).toBeNull()
    expect(result.current.actionNotice).toEqual({ text: "Deleted 'topic'", isError: false })
    expect(refresh).toHaveBeenCalled()
    window.removeEventListener('omniterm:git-refresh', refresh)
  })

  it('surfaces a refusal instead of failing silently, then forces on request', async () => {
    deletes = [
      { deleted: [], failed: [{ branch: 'topic', reason: "The branch 'topic' is not fully merged" }] },
      { deleted: ['topic'], failed: [] },
    ]
    const result = await renderOps()

    await act(async () => { await result.current.handleDeleteBranch('topic') })
    expect(result.current.pendingDelete).toEqual({ branch: 'topic', error: "The branch 'topic' is not fully merged" })

    await act(async () => { result.current.confirmDelete(true) })
    await waitFor(() => expect(result.current.pendingDelete).toBeNull())
    expect(mockInvoke).toHaveBeenCalledWith('git_delete_branches', { cwd: 'C:/repo', branches: ['topic'], force: true, removeWorktrees: false })
  })

  it('asks before deleting a branch an agent worktree holds, then removes both', async () => {
    worktrees = [
      worktree('C:/repo', { is_main: true, is_current: true, branch: 'main' }),
      worktree('C:/repo/.claude/worktrees/agent', { branch: 'claude/agent' }),
    ]
    deletes = [{ deleted: ['claude/agent'], failed: [], removed_worktrees: ['C:/repo/.claude/worktrees/agent'] }]
    const result = await renderOps()

    await act(async () => { await result.current.handleDeleteBranch('claude/agent') })
    expect(result.current.pendingDelete).toEqual({ branch: 'claude/agent', worktreePath: 'C:/repo/.claude/worktrees/agent' })
    expect(mockInvoke).not.toHaveBeenCalledWith('git_delete_branches', expect.anything())

    await act(async () => { result.current.confirmDelete(false) })
    await waitFor(() => expect(result.current.pendingDelete).toBeNull())
    expect(mockInvoke).toHaveBeenCalledWith('git_delete_branches', { cwd: 'C:/repo', branches: ['claude/agent'], force: false, removeWorktrees: true })
    expect(result.current.actionNotice?.text).toBe("Deleted 'claude/agent' and its worktree")
  })

  it('keeps the dialog open with the error when the delete call rejects, and can be cancelled', async () => {
    worktrees = new Error('no worktree support')
    const result = await renderOps()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'git_delete_branches') throw 'not a git repository'
      return []
    })

    await act(async () => { await result.current.handleDeleteBranch('topic') })
    expect(result.current.pendingDelete).toEqual({ branch: 'topic', error: 'not a git repository' })
    act(() => result.current.cancelDelete())
    expect(result.current.pendingDelete).toBeNull()
  })

  it('pulls the checked-out branch and fast-forwards any other branch without checkout', async () => {
    const result = await renderOps()

    await act(async () => { await result.current.handlePullBranch('main') })
    expect(mockInvoke).toHaveBeenCalledWith('git_pull', { cwd: 'C:/repo', rebase: false })
    expect(mockInvoke).not.toHaveBeenCalledWith('git_checkout', expect.anything())

    await act(async () => { await result.current.handlePullBranch('topic') })
    expect(mockInvoke).toHaveBeenCalledWith('git_update_branch', { cwd: 'C:/repo', branch: 'topic' })
    expect(mockInvoke).not.toHaveBeenCalledWith('git_checkout', expect.anything())
  })
})
