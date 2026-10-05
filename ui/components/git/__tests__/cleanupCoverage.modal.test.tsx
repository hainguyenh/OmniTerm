/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitBranchCleanupModal } from '../GitBranchCleanupModal'
import type { GitBranchInfo } from '../gitTypes'

const nowSec = Math.floor(Date.now() / 1000)

const branch = (overrides: Partial<GitBranchInfo> & { name: string }): GitBranchInfo => ({
  is_current: false,
  is_remote: false,
  ahead: 0,
  behind: 0,
  is_gone: false,
  ...overrides,
})

const BRANCHES: GitBranchInfo[] = [
  branch({ name: 'main', is_merged: true }),
  branch({ name: 'feat/current', is_current: true }),
  branch({
    name: 'feat/merged',
    is_merged: true,
    last_commit_author: 'Alice',
    last_commit_message: 'feat: add auth module',
    last_commit_timestamp: nowSec - 86400 * 3,
  }),
  branch({ name: 'feat/gone', is_gone: true, last_commit_message: 'chore: tidy up' }),
  branch({ name: 'feat/stale', last_commit_timestamp: nowSec - 86400 * 90, last_commit_author: 'Bob' }),
  branch({ name: 'feat/active', ahead: 2, last_commit_timestamp: nowSec - 3600 }),
  branch({ name: 'origin/feat/remote', is_remote: true, is_gone: true }),
]

const COMPARISON = { base_branch: 'main', target_branch: 'x', commits_ahead: [], commits_behind: [], files: [] }

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

const defaultInvoke = (cmd: string): Promise<unknown> => {
  if (cmd === 'git_compare_branches') return Promise.resolve(COMPARISON)
  if (cmd === 'git_fetch') return Promise.resolve('Fetched')
  if (cmd === 'git_delete_branches') return Promise.resolve({ deleted: ['feat/merged'], failed: [] })
  return Promise.resolve(null)
}

async function renderModal(props: Partial<React.ComponentProps<typeof GitBranchCleanupModal>> = {}) {
  const onRefreshBranches = props.onRefreshBranches ?? vi.fn().mockResolvedValue(undefined)
  await act(async () => {
    render(
      <GitBranchCleanupModal
        cwd="/repo"
        currentBranch="feat/current"
        branches={BRANCHES}
        onClose={vi.fn()}
        {...props}
        onRefreshBranches={onRefreshBranches}
      />,
    )
  })
  return { onRefreshBranches }
}

const filterButton = (label: RegExp) =>
  within(screen.getByRole('group', { name: 'Branch filter' })).getByRole('button', { name: label })
const rowNames = () =>
  screen.queryAllByRole('checkbox', { name: /^Select / }).map((box) => box.getAttribute('aria-label'))
const compareBases = () =>
  mockInvoke.mock.calls
    .filter(([cmd]) => cmd === 'git_compare_branches')
    .map(([, args]) => (args as { baseBranch: string }).baseBranch)

describe('GitBranchCleanupModal coverage', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation(defaultInvoke)
  })

  it('counts candidates per filter and excludes remote branches', async () => {
    await renderModal()
    expect(filterButton(/^Recommended/)).toHaveTextContent('3')
    expect(filterButton(/^Remote gone/)).toHaveTextContent('1')
    expect(filterButton(/^Merged/)).toHaveTextContent('1')
    expect(filterButton(/^Inactive/)).toHaveTextContent('1')
    expect(filterButton(/^All local/)).toHaveTextContent('6')
    expect(rowNames()).toEqual(['Select feat/merged', 'Select feat/gone', 'Select feat/stale'])

    fireEvent.click(filterButton(/^Merged/))
    expect(rowNames()).toEqual(['Select feat/merged'])
    fireEvent.click(filterButton(/^Inactive/))
    expect(rowNames()).toEqual(['Select feat/stale'])
    fireEvent.click(filterButton(/^All local/))
    expect(rowNames()).not.toContain('Select origin/feat/remote')
  })

  it('searches by name, author, and commit message and shows an empty state', async () => {
    await renderModal()
    fireEvent.click(filterButton(/^All local/))
    const search = screen.getByRole('searchbox', { name: 'Search cleanup branches' })

    fireEvent.change(search, { target: { value: '  ALICE ' } })
    expect(rowNames()).toEqual(['Select feat/merged'])
    fireEvent.change(search, { target: { value: 'tidy' } })
    expect(rowNames()).toEqual(['Select feat/gone'])
    fireEvent.change(search, { target: { value: 'stale' } })
    expect(rowNames()).toEqual(['Select feat/stale'])
    fireEvent.change(search, { target: { value: 'nothing-matches' } })
    expect(rowNames()).toEqual([])
    expect(screen.getByText('No matching branches')).toBeInTheDocument()
    // With no visible rows the viewer still inspects the first local branch.
    const viewer = screen.getByRole('region', { name: 'Branch comparison viewer' })
    expect(within(viewer).getByTitle('main')).toBeInTheDocument()
  })

  it.each([
    [[branch({ name: 'master' }), branch({ name: 'main' }), branch({ name: 'x' })], 'feat/current', 'master'],
    [[branch({ name: 'x', is_merged: true })], 'trunk-like', 'trunk-like'],
    [[branch({ name: 'x', is_merged: true })], undefined, 'HEAD'],
  ])('compares against the resolved default branch', async (branches, currentBranch, expected) => {
    await renderModal({ branches, currentBranch })
    await waitFor(() => expect(compareBases()).toContain(expected))
  })

  it('shows an inspect placeholder when there are no local branches', async () => {
    await renderModal({ branches: [branch({ name: 'origin/x', is_remote: true })] })
    expect(screen.getByText('Select a branch to inspect')).toBeInTheDocument()
    expect(mockInvoke).not.toHaveBeenCalledWith('git_compare_branches', expect.anything())
  })

  it('toggles selection, selects shown branches without protected ones, and clears', async () => {
    await renderModal()
    const review = () => screen.getByRole('button', { name: /^Review cleanup/ })
    expect(review()).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()

    const gone = screen.getByRole('checkbox', { name: 'Select feat/gone' })
    fireEvent.click(gone)
    expect(gone).toBeChecked()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    fireEvent.click(gone)
    expect(gone).not.toBeChecked()

    fireEvent.click(filterButton(/^All local/))
    fireEvent.click(screen.getByRole('button', { name: 'Select shown' }))
    expect(screen.getByText('4 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select main' })).not.toBeChecked()
    expect(review()).toHaveTextContent('Review cleanup (4)')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('0 selected')).toBeInTheDocument()
  })

  it('inspects a clicked branch and falls back when it disappears', async () => {
    const props = {
      cwd: '/repo',
      currentBranch: 'feat/current',
      onClose: vi.fn(),
      onRefreshBranches: vi.fn().mockResolvedValue(undefined),
    }
    let view: ReturnType<typeof render> | undefined
    await act(async () => {
      view = render(<GitBranchCleanupModal {...props} branches={BRANCHES} />)
    })
    fireEvent.click(screen.getByRole('button', { name: /feat\/stale/ }))
    const viewer = () => screen.getByRole('region', { name: 'Branch comparison viewer' })
    expect(within(viewer()).getByTitle('feat/stale')).toBeInTheDocument()

    await act(async () => {
      view?.rerender(<GitBranchCleanupModal {...props} branches={BRANCHES.filter((b) => b.name !== 'feat/stale')} />)
    })
    expect(within(viewer()).getByTitle('feat/merged')).toBeInTheDocument()
  })

  it('reviews a single deletion from the detail view and can return to the viewer', async () => {
    await renderModal()
    fireEvent.click(screen.getByRole('button', { name: /feat\/gone/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review deletion' }))
    const plan = screen.getByRole('region', { name: 'Cleanup plan editor' })
    expect(within(plan).getByText('1 local branch selected for deletion')).toBeInTheDocument()
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    fireEvent.click(within(plan).getByRole('button', { name: 'Back to viewer' }))
    expect(screen.queryByRole('region', { name: 'Cleanup plan editor' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Branch comparison viewer' })).toBeInTheDocument()
  })

  it('force-deletes selected branches and reports partial failures', async () => {
    mockInvoke.mockImplementation((cmd: string) => cmd === 'git_delete_branches'
      ? Promise.resolve({ deleted: ['feat/merged'], failed: [{ branch: 'feat/stale', reason: 'not fully merged' }] })
      : defaultInvoke(cmd))
    const refreshEvents = vi.fn()
    window.addEventListener('omniterm:git-refresh', refreshEvents)
    const { onRefreshBranches } = await renderModal()

    fireEvent.click(screen.getByRole('button', { name: /^Select recommended/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Review cleanup/ }))
    const plan = screen.getByRole('region', { name: 'Cleanup plan editor' })
    fireEvent.click(within(plan).getByRole('checkbox'))
    await act(async () => {
      fireEvent.click(within(plan).getByRole('button', { name: 'Delete 3 branches' }))
    })

    expect(mockInvoke).toHaveBeenCalledWith('git_delete_branches', {
      cwd: '/repo',
      branches: ['feat/merged', 'feat/gone', 'feat/stale'],
      force: true,
    })
    expect(onRefreshBranches).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Deleted 1 branch(es). 1 failed: not fully merged')
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(refreshEvents).toHaveBeenCalledTimes(1)
    window.removeEventListener('omniterm:git-refresh', refreshEvents)
  })

  it('reports successful deletion as status', async () => {
    await renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select feat/merged' }))
    fireEvent.click(screen.getByRole('button', { name: /^Review cleanup/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete 1 branch' }))
    })
    expect(screen.getByRole('status')).toHaveTextContent('Deleted 1 branch(es) successfully.')
    expect(screen.getByText('0 selected')).toBeInTheDocument()
  })

  it.each([
    ['branch is locked', 'branch is locked'],
    [new Error('boom'), 'Error deleting branches'],
  ])('surfaces delete errors (%s)', async (failure, message) => {
    mockInvoke.mockImplementation((cmd: string) => cmd === 'git_delete_branches'
      ? Promise.reject(failure)
      : defaultInvoke(cmd))
    const { onRefreshBranches } = await renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select feat/gone' }))
    fireEvent.click(screen.getByRole('button', { name: /^Review cleanup/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete 1 branch' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(onRefreshBranches).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Review cleanup/ })).toBeEnabled()
  })

  it('disables actions while a deletion is in flight', async () => {
    let resolveDelete: (value: unknown) => void = () => undefined
    mockInvoke.mockImplementation((cmd: string) => cmd === 'git_delete_branches'
      ? new Promise((resolve) => { resolveDelete = resolve })
      : defaultInvoke(cmd))
    await renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select feat/gone' }))
    fireEvent.click(screen.getByRole('button', { name: /^Review cleanup/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete 1 branch' }))
    })
    expect(screen.getByRole('button', { name: 'Fetch & Prune' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Review cleanup/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Review deletion' })).toBeDisabled()

    await act(async () => {
      resolveDelete({ deleted: ['feat/gone'], failed: [] })
    })
    expect(screen.getByRole('button', { name: 'Fetch & Prune' })).toBeEnabled()
  })

  it('shows fetch progress and success', async () => {
    let resolveFetch: (value: unknown) => void = () => undefined
    mockInvoke.mockImplementation((cmd: string) => cmd === 'git_fetch'
      ? new Promise((resolve) => { resolveFetch = resolve })
      : defaultInvoke(cmd))
    const { onRefreshBranches } = await renderModal()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch & Prune' }))
    })
    expect(screen.getByRole('button', { name: 'Fetching…' })).toBeDisabled()
    await act(async () => {
      resolveFetch('ok')
    })
    expect(onRefreshBranches).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Remotes fetched and pruned successfully.')
  })

  it.each([
    ['remote unreachable', 'remote unreachable'],
    [{ code: 1 }, 'Failed to fetch remotes'],
  ])('surfaces fetch errors (%s)', async (failure, message) => {
    mockInvoke.mockImplementation((cmd: string) => cmd === 'git_fetch' ? Promise.reject(failure) : defaultInvoke(cmd))
    const { onRefreshBranches } = await renderModal()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch & Prune' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(onRefreshBranches).not.toHaveBeenCalled()
  })

  it('closes from the header button', async () => {
    const onClose = vi.fn()
    await renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Changes' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
