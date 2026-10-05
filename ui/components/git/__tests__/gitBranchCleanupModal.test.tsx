/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitBranchCleanupModal } from '../GitBranchCleanupModal'
import type { GitBranchInfo } from '../gitTypes'

const mockBranches: GitBranchInfo[] = [
  {
    name: 'master',
    is_current: false,
    is_remote: false,
    ahead: 0,
    behind: 0,
    is_gone: false,
    is_merged: true,
  },
  {
    name: 'feat/active-wip',
    is_current: true,
    is_remote: false,
    ahead: 1,
    behind: 0,
    is_gone: false,
    last_commit_timestamp: Math.floor(Date.now() / 1000) - 3600,
  },
  {
    name: 'feat/pr-already-merged',
    is_current: false,
    is_remote: false,
    ahead: 0,
    behind: 0,
    is_gone: true,
    is_merged: true,
    last_commit_timestamp: Math.floor(Date.now() / 1000) - 86400 * 10,
    last_commit_author: 'Alice',
    last_commit_message: 'feat: add auth module',
  },
  {
    name: 'feat/abandoned-stale',
    is_current: false,
    is_remote: false,
    ahead: 0,
    behind: 5,
    is_gone: false,
    is_merged: false,
    last_commit_timestamp: Math.floor(Date.now() / 1000) - 86400 * 60,
    last_commit_author: 'Bob',
    last_commit_message: 'experiment: old draft',
  },
]

const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
  if (cmd === 'git_delete_branches') {
    return Promise.resolve({ deleted: ['feat/pr-already-merged'], failed: [] })
  }
  if (cmd === 'git_compare_branches') {
    return Promise.resolve({
      base_branch: 'master',
      target_branch: 'feat/pr-already-merged',
      commits_ahead: [],
      commits_behind: [],
      files: [],
    })
  }
  if (cmd === 'git_fetch') {
    return Promise.resolve('Fetched')
  }
  return Promise.resolve(null)
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

describe('GitBranchCleanupModal', () => {
  beforeEach(() => {
    mockInvoke.mockClear()
  })

  it('renders cleanup candidates and filters by tabs', async () => {
    await act(async () => {
      render(
        <GitBranchCleanupModal
          cwd="/repo"
          currentBranch="feat/active-wip"
          branches={mockBranches}
          onClose={vi.fn()}
          onRefreshBranches={vi.fn()}
        />,
      )
    })

    expect(screen.getByRole('region', { name: 'Local Branch Cleanup & Prune' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Branch Cleanup & Prune' })).toBeInTheDocument()
    const filters = screen.getByRole('group', { name: 'Branch filter' })
    const rowFor = (name: string) => screen.queryByRole('checkbox', { name: `Select ${name}` })

    // Default tab is 'recommended': protected branches are not offered
    expect(within(filters).getByRole('button', { name: /^Recommended/ })).toHaveAttribute('aria-pressed', 'true')
    expect(rowFor('feat/pr-already-merged')).toBeInTheDocument()
    expect(rowFor('master')).not.toBeInTheDocument()
    expect(rowFor('feat/active-wip')).not.toBeInTheDocument()

    // Filter to 'Remote gone' tab
    const goneTab = within(filters).getByRole('button', { name: /^Remote gone/ })
    await act(async () => {
      fireEvent.click(goneTab)
    })
    expect(goneTab).toHaveAttribute('aria-pressed', 'true')
    expect(rowFor('feat/pr-already-merged')).toBeInTheDocument()
    expect(rowFor('feat/abandoned-stale')).not.toBeInTheDocument()

    // Filter to 'All local' tab
    const allTab = within(filters).getByRole('button', { name: /^All local/ })
    await act(async () => {
      fireEvent.click(allTab)
    })
    expect(rowFor('master')).toBeInTheDocument()
    expect(rowFor('feat/active-wip')).toBeInTheDocument()
    // Protected branches are listed but cannot be selected for deletion.
    expect(rowFor('feat/active-wip')).toBeDisabled()
  })

  it('allows bulk selecting recommended branches and deleting them', async () => {
    const onRefreshBranches = vi.fn().mockResolvedValue(undefined)
    await act(async () => {
      render(
        <GitBranchCleanupModal
          cwd="/repo"
          currentBranch="feat/active-wip"
          branches={mockBranches}
          onClose={vi.fn()}
          onRefreshBranches={onRefreshBranches}
        />,
      )
    })

    // Click 'Select recommended'
    const selectRecBtn = screen.getByRole('button', { name: /^Select recommended/ })
    act(() => {
      fireEvent.click(selectRecBtn)
    })
    expect(screen.getByRole('checkbox', { name: 'Select feat/pr-already-merged' })).toBeChecked()

    // Open the cleanup plan for the selection
    const reviewBtn = screen.getByRole('button', { name: /^Review cleanup \([1-9]\d*\)$/ })
    act(() => {
      fireEvent.click(reviewBtn)
    })

    // The plan editor replaces the viewer and lists the selected branches
    const plan = screen.getByRole('region', { name: 'Cleanup plan editor' })
    expect(within(plan).getByText('feat/pr-already-merged')).toBeInTheDocument()

    // Confirm deletion
    const confirmBtn = within(plan).getByRole('button', { name: /^Delete \d+ branch(es)?$/ })
    await act(async () => {
      fireEvent.click(confirmBtn)
    })

    expect(mockInvoke).toHaveBeenCalledWith(
      'git_delete_branches',
      expect.objectContaining({
        cwd: '/repo',
        branches: expect.arrayContaining(['feat/pr-already-merged']),
        force: false,
      }),
    )
    expect(onRefreshBranches).toHaveBeenCalled()
  })

  it('triggers remote fetch and prune', async () => {
    const onRefreshBranches = vi.fn().mockResolvedValue(undefined)
    await act(async () => {
      render(
        <GitBranchCleanupModal
          cwd="/repo"
          currentBranch="feat/active-wip"
          branches={mockBranches}
          onClose={vi.fn()}
          onRefreshBranches={onRefreshBranches}
        />,
      )
    })

    const fetchBtn = screen.getByRole('button', { name: /Fetch & Prune/i })
    await act(async () => {
      fireEvent.click(fetchBtn)
    })

    expect(mockInvoke).toHaveBeenCalledWith('git_fetch', { cwd: '/repo', prune: true })
    expect(onRefreshBranches).toHaveBeenCalled()
  })
})
