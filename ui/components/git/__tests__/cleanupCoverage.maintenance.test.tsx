/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitBranchMaintenance } from '../GitBranchMaintenance'
import type { GitBranchInfo } from '../gitTypes'

const mockInvoke = vi.fn()
const refreshOutcomes: string[] = []

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('../GitBranchCleanupModal', () => ({
  GitBranchCleanupModal: ({ branches, currentBranch, onClose, onRefreshBranches }: {
    branches: GitBranchInfo[]
    currentBranch?: string
    onClose: () => void
    onRefreshBranches: () => Promise<void>
  }) => (
    <div data-testid="cleanup">
      <span>{`${currentBranch ?? 'none'}: ${branches.map((b) => b.name).join(',')}`}</span>
      <button type="button" onClick={onClose}>close</button>
      <button
        type="button"
        onClick={() => {
          onRefreshBranches().then(
            () => refreshOutcomes.push('ok'),
            (reason: unknown) => refreshOutcomes.push(`failed:${String(reason)}`),
          )
        }}
      >refresh</button>
    </div>
  ),
}))

const branch = (name: string): GitBranchInfo => ({
  name,
  is_current: false,
  is_remote: false,
  ahead: 0,
  behind: 0,
  is_gone: false,
})

interface Deferred {
  resolve: (value: GitBranchInfo[]) => void
  reject: (reason: unknown) => void
}

function queueRequests() {
  const pending: Deferred[] = []
  mockInvoke.mockImplementation(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }))
  return pending
}

describe('GitBranchMaintenance', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    refreshOutcomes.length = 0
  })

  it('shows a loading state and then the cleanup workspace', async () => {
    const pending = queueRequests()
    const onClose = vi.fn()
    render(<GitBranchMaintenance cwd="/repo" currentBranch="dev" onClose={onClose} />)
    expect(screen.getByRole('status')).toHaveTextContent('Reading branches…')
    expect(mockInvoke).toHaveBeenCalledWith('git_branches', { cwd: '/repo' })

    await act(async () => {
      pending[0].resolve([branch('dev'), branch('feat/a')])
    })
    expect(screen.getByText('dev: dev,feat/a')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each([
    [new Error('not a git repository'), 'not a git repository'],
    ['permission denied', 'permission denied'],
  ])('shows load errors (%s) and retries', async (failure, message) => {
    const pending = queueRequests()
    render(<GitBranchMaintenance cwd="/repo" onClose={vi.fn()} />)
    await act(async () => {
      pending[0].reject(failure)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(message)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    await act(async () => {
      pending[1].resolve([branch('feat/b')])
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('none: feat/b')).toBeInTheDocument()
  })

  it('lets the workspace refresh branches and propagates refresh failures', async () => {
    const pending = queueRequests()
    render(<GitBranchMaintenance cwd="/repo" onClose={vi.fn()} />)
    await act(async () => {
      pending[0].resolve([branch('feat/a')])
    })

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await act(async () => {
      pending[1].resolve([branch('feat/a'), branch('feat/new')])
    })
    expect(screen.getByText('none: feat/a,feat/new')).toBeInTheDocument()
    expect(refreshOutcomes).toEqual(['ok'])

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await act(async () => {
      pending[2].reject('fetch failed')
    })
    expect(refreshOutcomes).toEqual(['ok', 'failed:fetch failed'])
    expect(screen.getByRole('alert')).toHaveTextContent('fetch failed')
  })

  it('ignores stale responses after the repository changes', async () => {
    const pending = queueRequests()
    const { rerender } = render(<GitBranchMaintenance cwd="/repo-a" onClose={vi.fn()} />)
    rerender(<GitBranchMaintenance cwd="/repo-b" onClose={vi.fn()} />)
    expect(mockInvoke).toHaveBeenLastCalledWith('git_branches', { cwd: '/repo-b' })

    await act(async () => {
      pending[0].resolve([branch('from-a')])
    })
    expect(screen.getByRole('status')).toHaveTextContent('Reading branches…')

    await act(async () => {
      pending[1].resolve([branch('from-b')])
    })
    expect(screen.getByText('none: from-b')).toBeInTheDocument()
  })

  it('ignores a stale failure after the repository changes', async () => {
    const pending = queueRequests()
    const { rerender } = render(<GitBranchMaintenance cwd="/repo-a" onClose={vi.fn()} />)
    rerender(<GitBranchMaintenance cwd="/repo-b" onClose={vi.fn()} />)
    await act(async () => {
      pending[0].reject(new Error('repo-a vanished'))
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
