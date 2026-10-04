/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitWorkspaceView } from '../GitWorkspaceView'
import { requestFileDiff } from '../gitFileDiffRequest'
import type { GitFileChange, GitRepoStatus } from '../gitTypes'

const api = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getLog: vi.fn(),
  commit: vi.fn(),
  revert: vi.fn(),
  fetch: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  stage: vi.fn(),
  unstage: vi.fn(),
}))
vi.mock('../../../gitAPI', () => ({ createGitAPI: () => api }))

vi.mock('../GitDiffViewer', () => ({
  GitDiffViewer: (props: {
    filePath: string
    staged: boolean
    targetBranch?: string
    allFiles?: Array<{ path: string; staged: boolean }>
    onSelectFile: (path: string, staged: boolean) => void
    onClose: () => void
  }) => (
    <div
      data-testid="diff-viewer"
      data-path={props.filePath}
      data-staged={String(props.staged)}
      data-branch={props.targetBranch ?? ''}
      data-files={JSON.stringify(props.allFiles)}
    >
      <button type="button" onClick={() => props.onSelectFile('picked.ts', true)}>stub pick file</button>
      <button type="button" onClick={props.onClose}>stub close diff</button>
    </div>
  ),
}))

vi.mock('../GitBranchPopup', () => ({
  GitBranchPopup: (props: {
    cwd: string
    onClose: () => void
    onOpenFileDiff?: (path: string, branch: string) => void
    onBranchSwitched?: () => void
  }) => (
    <div data-testid="branch-popup" data-cwd={props.cwd}>
      <button type="button" onClick={() => props.onOpenFileDiff?.('popup.ts', 'develop')}>stub open diff</button>
      <button type="button" onClick={() => props.onBranchSwitched?.()}>stub switched</button>
      <button type="button" onClick={props.onClose}>stub close popup</button>
    </div>
  ),
}))

vi.mock('../GitBranchMaintenance', () => ({
  GitBranchMaintenance: (props: { cwd: string; currentBranch?: string; onClose: () => void }) => (
    <div data-testid="maintenance" data-cwd={props.cwd} data-branch={props.currentBranch ?? ''}>
      <button type="button" onClick={props.onClose}>stub close maintenance</button>
    </div>
  ),
}))

vi.mock('../GitGraphSection', () => ({
  GitGraphSection: (props: { cwd?: string; commits: unknown[] }) => (
    <div data-testid="graph" data-cwd={props.cwd ?? ''} data-count={props.commits.length} />
  ),
}))

const change = (path: string, staged: GitFileChange['staged'], unstaged: GitFileChange['unstaged']): GitFileChange => ({
  path,
  staged,
  unstaged,
  is_conflicted: false,
})

const makeStatus = (files: GitFileChange[], extra: Partial<GitRepoStatus> = {}): GitRepoStatus => ({
  repo_root: '/repo',
  branch: 'main',
  ahead: 0,
  behind: 0,
  is_detached: false,
  conflict_count: 0,
  files,
  ...extra,
})

const nav = () => screen.getByRole('navigation', { name: 'Git workspace views' })

describe('GitWorkspaceView coverage', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const fn of Object.values(api)) fn.mockReset()
    api.getStatus.mockResolvedValue(makeStatus([change('a.ts', 'unmodified', 'modified')]))
    api.getLog.mockResolvedValue([])
    api.commit.mockResolvedValue('ok')
    api.revert.mockResolvedValue(undefined)
    api.stage.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('restores the maintenance tab from storage and returns to changes when it closes', async () => {
    localStorage.setItem('omniterm:git-active-tab', 'maintenance')
    render(<GitWorkspaceView cwd="/repo" onClose={vi.fn()} />)

    const maintenance = await screen.findByTestId('maintenance')
    expect(maintenance).toHaveAttribute('data-cwd', '/repo')
    await waitFor(() => expect(screen.getByTestId('maintenance')).toHaveAttribute('data-branch', 'main'))
    expect(within(nav()).getByRole('button', { name: 'Cleanup & Prune' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('button', { name: 'stub close maintenance' }))
    expect(screen.queryByTestId('maintenance')).not.toBeInTheDocument()
    expect(screen.getByText('Local Changes')).toBeInTheDocument()
    expect(localStorage.getItem('omniterm:git-active-tab')).toBe('changes')
  })

  it('shows the stored graph tab only while the graph feature is enabled', async () => {
    localStorage.setItem('omniterm:git-active-tab', 'graph')
    api.getLog.mockResolvedValue([{ id: '1', short_id: '1', summary: 's', author_name: 'a', author_email: 'e', timestamp: 1, parents: [] }])
    const { unmount } = render(<GitWorkspaceView cwd="/repo" onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('graph')).toHaveAttribute('data-count', '1'))
    expect(screen.queryByText('Local Changes')).not.toBeInTheDocument()
    unmount()

    render(<GitWorkspaceView cwd="/repo" gitGraphEnabled={false} onClose={vi.fn()} />)
    expect(screen.queryByTestId('graph')).not.toBeInTheDocument()
    expect(screen.getByText('Local Changes')).toBeInTheDocument()
    await screen.findByTestId('diff-viewer')
  })

  it('falls back to the changes tab when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<GitWorkspaceView cwd="/repo" onClose={vi.fn()} />)
    expect(within(nav()).getByRole('button', { name: /^Changes & Diff/ })).toHaveAttribute('aria-current', 'page')
    await screen.findByTestId('diff-viewer')

    fireEvent.click(within(nav()).getByRole('button', { name: 'Commit Graph' }))
    expect(screen.getByTestId('graph')).toBeInTheDocument()
    expect(within(nav()).getByRole('button', { name: 'Commit Graph' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders empty states and skips git calls without any repository', async () => {
    render(<GitWorkspaceView onClose={vi.fn()} />)
    expect(screen.getByText('No workspace folder')).toBeInTheDocument()
    expect(screen.getByText('Diff Viewer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fetch' })).toBeDisabled()
    expect(api.getStatus).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'amend nothing' } })
    fireEvent.click(screen.getByRole('checkbox'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    })
    expect(api.commit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Commit message')).toHaveValue('')

    fireEvent.click(within(nav()).getByRole('button', { name: 'Cleanup & Prune' }))
    expect(screen.getByText('Select a repository to manage branches.')).toBeInTheDocument()
    expect(screen.queryByTestId('maintenance')).not.toBeInTheDocument()
  })

  it('reports string status errors, offers initialization, and retries', async () => {
    api.getStatus.mockRejectedValueOnce('fatal: not a git repository')
    api.getLog.mockRejectedValue(new Error('no log'))
    const ws = [{ id: 'w', name: 'W', order: 0, pins: [], folders: [{ id: 'f', name: 'Repo', path: '/repo' }] }]
    render(<GitWorkspaceView cwd="/repo" workspaces={ws} onClose={vi.fn()} />)

    expect(await screen.findByText('fatal: not a git repository')).toBeInTheDocument()
    expect(screen.getByText('Cannot Read Git Repository')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Initialize Git' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry Detection' }))
    })
    await waitFor(() => expect(screen.queryByText('Cannot Read Git Repository')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Current branch: main' })).toBeInTheDocument()
    expect(api.getStatus).toHaveBeenCalledTimes(2)
  })

  it('uses a generic message for non-string status failures', async () => {
    api.getStatus.mockRejectedValue(new Error('boom'))
    render(<GitWorkspaceView cwd="/repo" onClose={vi.fn()} />)
    expect(await screen.findByText('Failed to query git status')).toBeInTheDocument()
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
  })

  it('selects the first change, keeps a valid selection on refresh, and clears it when clean', async () => {
    api.getStatus.mockResolvedValue(makeStatus([
      change('a.ts', 'modified', 'modified'),
      change('b.ts', 'unmodified', 'modified'),
    ]))
    render(<GitWorkspaceView cwd="/repo" onClose={vi.fn()} />)

    const viewer = await screen.findByTestId('diff-viewer')
    expect(viewer).toHaveAttribute('data-path', 'a.ts')
    expect(viewer).toHaveAttribute('data-staged', 'true')
    expect(JSON.parse(viewer.getAttribute('data-files') ?? '[]')).toEqual([
      { path: 'a.ts', staged: true },
      { path: 'a.ts', staged: false },
      { path: 'b.ts', staged: false },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'View working tree diff for b.ts' }))
    expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-path', 'b.ts')
    await act(async () => {
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    })
    expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-path', 'b.ts')

    fireEvent.click(screen.getByRole('button', { name: 'stub pick file' }))
    expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-path', 'picked.ts')
    await act(async () => {
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    })
    expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-path', 'a.ts')

    fireEvent.click(screen.getByRole('button', { name: 'stub close diff' }))
    expect(screen.getByText('Diff Viewer')).toBeInTheDocument()

    api.getStatus.mockResolvedValue(makeStatus([]))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    })
    expect(screen.queryByTestId('diff-viewer')).not.toBeInTheDocument()
    expect(screen.getByText('No local changes')).toBeInTheDocument()
  })

  it('shows a diff parked before mount and diffs requested by window events', async () => {
    api.getStatus.mockResolvedValue(makeStatus([change('a.ts', 'unmodified', 'modified'), change('parked.ts', 'unmodified', 'modified')]))
    requestFileDiff({ path: 'parked.ts', targetBranch: 'release' })
    render(<GitWorkspaceView cwd="/repo" onClose={vi.fn()} />)

    await waitFor(() => expect(api.getStatus).toHaveBeenCalled())
    const viewer = await screen.findByTestId('diff-viewer')
    expect(viewer).toHaveAttribute('data-path', 'parked.ts')
    expect(viewer).toHaveAttribute('data-branch', 'release')

    fireEvent.click(within(nav()).getByRole('button', { name: 'Commit Graph' }))
    act(() => {
      window.dispatchEvent(new CustomEvent('omniterm:open-file-diff', { detail: { path: '' } }))
      window.dispatchEvent(new CustomEvent('omniterm:open-file-diff'))
    })
    expect(screen.getByTestId('graph')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent('omniterm:open-file-diff', { detail: { path: 'evt.ts', targetBranch: 'dev' } }))
    })
    expect(screen.queryByTestId('graph')).not.toBeInTheDocument()
    expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-path', 'evt.ts')
    expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-branch', 'dev')
  })

  it('drives the branch popup callbacks and closes it for maintenance requests', async () => {
    const refreshSpy = vi.fn()
    window.addEventListener('omniterm:git-refresh', refreshSpy)
    render(<GitWorkspaceView cwd="/repo" onClose={vi.fn()} />)
    await screen.findByTestId('diff-viewer')

    fireEvent.click(screen.getByRole('button', { name: 'Current branch: main' }))
    expect(screen.getByTestId('branch-popup')).toHaveAttribute('data-cwd', '/repo')

    fireEvent.click(within(nav()).getByRole('button', { name: 'Commit Graph' }))
    fireEvent.click(screen.getByRole('button', { name: 'stub open diff' }))
    expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-path', 'popup.ts')
    expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-branch', 'develop')

    const calls = api.getStatus.mock.calls.length
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'stub switched' }))
    })
    expect(api.getStatus.mock.calls.length).toBeGreaterThan(calls)
    expect(refreshSpy).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'stub close popup' }))
    expect(screen.queryByTestId('branch-popup')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Current branch: main' }))
    act(() => {
      window.dispatchEvent(new CustomEvent('omniterm:open-git-maintenance'))
    })
    expect(screen.queryByTestId('branch-popup')).not.toBeInTheDocument()
    expect(screen.getByTestId('maintenance')).toBeInTheDocument()
    window.removeEventListener('omniterm:git-refresh', refreshSpy)
  })

  it('runs fetch, pull, and push and reports their outcomes', async () => {
    let finishFetch: (value: string) => void = () => undefined
    api.fetch.mockReturnValue(new Promise<string>((resolve) => {
      finishFetch = resolve
    }))
    api.pull.mockResolvedValue('')
    api.push.mockRejectedValue('remote rejected')
    render(<GitWorkspaceView cwd="/repo" onClose={vi.fn()} />)
    await screen.findByTestId('diff-viewer')

    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    expect(screen.getByText('Fetch…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pull' })).toBeDisabled()
    await act(async () => {
      finishFetch('Fetched origin')
    })
    expect(await screen.findByText('Fetched origin')).toBeInTheDocument()
    expect(api.fetch).toHaveBeenCalledWith('/repo')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    })
    expect(await screen.findByText('pull completed')).toBeInTheDocument()
    expect(api.pull).toHaveBeenCalledWith('/repo', false)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    })
    expect(await screen.findByText('push failed: remote rejected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push' })).not.toBeDisabled()
  })

  it('commits checked unstaged files and discards selected changes', async () => {
    const refreshSpy = vi.fn()
    window.addEventListener('omniterm:git-refresh', refreshSpy)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<GitWorkspaceView cwd="/repo" onClose={vi.fn()} />)
    await screen.findByTestId('diff-viewer')

    fireEvent.click(screen.getByRole('button', { name: 'Check a.ts' }))
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'feat: ship' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    })
    expect(api.stage).toHaveBeenCalledWith('/repo', ['a.ts'])
    expect(api.commit).toHaveBeenCalledWith('/repo', 'feat: ship', false)
    expect(refreshSpy).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Check a.ts' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard selected changes' }))
    })
    expect(api.revert).toHaveBeenCalledWith('/repo', ['a.ts'])
    expect(refreshSpy).toHaveBeenCalledTimes(2)
    window.removeEventListener('omniterm:git-refresh', refreshSpy)
  })

  it('clamps the changes pane width while dragging the resizer', async () => {
    render(<GitWorkspaceView cwd="/repo" onClose={vi.fn()} />)
    await screen.findByTestId('diff-viewer')
    const pane = document.querySelector<HTMLElement>('.git-changes-pane')
    const width = () => pane?.style.getPropertyValue('--git-changes-width')
    expect(width()).toBe('380px')

    fireEvent.mouseDown(screen.getByTitle('Drag to resize panes'))
    fireEvent.mouseMove(window, { clientX: 500 })
    expect(width()).toBe('452px')
    fireEvent.mouseMove(window, { clientX: 10 })
    expect(width()).toBe('260px')
    fireEvent.mouseMove(window, { clientX: 5000 })
    expect(width()).toBe('700px')
    fireEvent.mouseUp(window)
    fireEvent.mouseMove(window, { clientX: 500 })
    expect(width()).toBe('700px')
  })
})
