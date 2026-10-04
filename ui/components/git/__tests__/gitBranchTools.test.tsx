/** @vitest-environment jsdom */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitBranchTools } from '../GitBranchTools'
import { GitBranchUpdateDialog } from '../GitBranchUpdateDialog'
import type { GitBranchInfo } from '../gitTypes'
import { useGitBranchOps } from '../useGitBranchOps'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}))

const topic: GitBranchInfo = {
  name: 'topic',
  is_current: false,
  is_remote: false,
  upstream: 'origin/topic',
  ahead: 0,
  behind: 2,
  is_gone: false,
}

function openTools(props: Partial<Parameters<typeof GitBranchTools>[0]> = {}) {
  const actions = {
    onRename: vi.fn().mockResolvedValue(null),
    onSetUpstream: vi.fn().mockResolvedValue(null),
    onAddWorktree: vi.fn().mockResolvedValue(null),
    ...props,
  }
  render(<GitBranchTools branch={topic} isCurrent={false} remoteBranches={['origin/main', 'origin/topic']} busy={false} {...actions} />)
  fireEvent.click(screen.getByText('More branch tools'))
  return actions
}

describe('GitBranchUpdateDialog', () => {
  it('updates the branch and closes on success', async () => {
    const onUpdate = vi.fn().mockResolvedValue(null)
    const onClose = vi.fn()
    render(<GitBranchUpdateDialog branch={topic} currentBranch="main" onUpdate={onUpdate} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /Update topic/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onUpdate).toHaveBeenCalledWith('topic')
  })

  it('keeps the refusal visible and stays open', async () => {
    const onClose = vi.fn()
    render(<GitBranchUpdateDialog branch={topic} onUpdate={vi.fn().mockResolvedValue("'topic' has diverged")} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /Update topic/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent("'topic' has diverged")
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cannot update a branch without an upstream', () => {
    render(<GitBranchUpdateDialog branch={{ ...topic, upstream: undefined }} onUpdate={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Update topic/ })).toBeDisabled()
    expect(screen.getByRole('note')).toHaveTextContent('No upstream')
  })
})

describe('GitBranchTools', () => {
  it('renames the branch from an inline form', async () => {
    const { onRename } = openTools()
    fireEvent.click(screen.getByRole('button', { name: 'Rename branch' }))
    const input = screen.getByLabelText('New branch name')
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
    fireEvent.change(input, { target: { value: 'feature/topic' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('topic', 'feature/topic'))
    await waitFor(() => expect(screen.queryByLabelText('New branch name')).not.toBeInTheDocument())
  })

  it('tracks or stops tracking an upstream', async () => {
    const { onSetUpstream } = openTools()
    fireEvent.click(screen.getByRole('button', { name: 'Set upstream' }))
    fireEvent.change(screen.getByLabelText('Upstream branch'), { target: { value: 'origin/main' } })
    fireEvent.click(screen.getByRole('button', { name: 'Track' }))
    await waitFor(() => expect(onSetUpstream).toHaveBeenCalledWith('topic', 'origin/main'))

    fireEvent.click(screen.getByRole('button', { name: 'Set upstream' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop tracking' }))
    await waitFor(() => expect(onSetUpstream).toHaveBeenLastCalledWith('topic', null))
  })

  it('opens a worktree and shows git refusals', async () => {
    const { onAddWorktree } = openTools({ onAddWorktree: vi.fn().mockResolvedValue('already exists') })
    fireEvent.click(screen.getByRole('button', { name: 'Open in worktree' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(onAddWorktree).toHaveBeenCalledWith('topic')
  })

  it('offers only the worktree tool for a remote branch and none for the checked-out one', () => {
    openTools({ branch: { ...topic, name: 'origin/topic', is_remote: true }, isCurrent: true })
    expect(screen.queryByRole('button', { name: 'Rename branch' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open in worktree' })).toBeDisabled()
  })
})

describe('useGitBranchOps branch tools', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'git_branches') return [topic]
      if (cmd === 'git_add_worktree') return 'C:/repo.worktrees/topic'
      if (cmd === 'git_update_branch') throw new Error("'topic' has diverged")
      return 'ok'
    })
  })

  it('reports failures as text and opens a terminal in a new worktree', async () => {
    const onSession = vi.fn()
    window.addEventListener('omniterm:new-session', onSession)
    const { result } = renderHook(() => useGitBranchOps({ cwd: 'C:/repo', onClose: vi.fn() }))
    await waitFor(() => expect(result.current.branches).toHaveLength(1))

    let failure: string | null = null
    await act(async () => { failure = await result.current.handleUpdateBranch('topic') })
    expect(failure).toContain('diverged')

    await act(async () => { failure = await result.current.handleAddWorktree('topic') })
    expect(failure).toBeNull()
    expect(mockInvoke).toHaveBeenCalledWith('git_add_worktree', { cwd: 'C:/repo', branch: 'topic', path: null })
    expect((onSession.mock.calls[0][0] as CustomEvent).detail).toEqual({ cwd: 'C:/repo.worktrees/topic' })

    await act(async () => { failure = await result.current.handleRenameBranch('topic', ' next ') })
    expect(mockInvoke).toHaveBeenCalledWith('git_rename_branch', { cwd: 'C:/repo', branch: 'topic', newName: 'next' })
    await act(async () => { failure = await result.current.handleSetUpstream('topic', null) })
    expect(mockInvoke).toHaveBeenCalledWith('git_set_upstream', { cwd: 'C:/repo', branch: 'topic', upstream: null })
    window.removeEventListener('omniterm:new-session', onSession)
  })
})
