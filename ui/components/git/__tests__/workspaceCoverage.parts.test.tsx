/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitBranchFooter } from '../GitBranchFooter'
import { GitCommitForm } from '../GitCommitForm'
import { GitContextMenu } from '../GitContextMenu'
import { GitWorkspaceToolbar } from '../GitWorkspaceToolbar'
import type { GitRepoStatus } from '../gitTypes'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

vi.mock('../GitBranchPopup', () => ({
  GitBranchPopup: (props: {
    cwd: string
    currentBranch?: string
    onClose: () => void
    onOpenCommit?: () => void
    onBranchSwitched?: () => void
  }) => (
    <div data-testid="branch-popup" data-cwd={props.cwd} data-branch={props.currentBranch ?? ''}>
      <button type="button" onClick={() => props.onOpenCommit?.()}>stub open commit</button>
      <button type="button" onClick={() => props.onBranchSwitched?.()}>stub switched</button>
      <button type="button" onClick={props.onClose}>stub close popup</button>
    </div>
  ),
}))

vi.mock('../GitBranchQuickPopover', () => ({
  GitBranchQuickPopover: (props: {
    cwd: string
    currentBranch?: string
    onClose: () => void
    onExpand: () => void
    onBranchSwitched?: () => void
  }) => (
    <div data-testid="branch-popup" data-cwd={props.cwd} data-branch={props.currentBranch ?? ''}>
      <button type="button" onClick={() => props.onExpand()}>stub expand</button>
      <button type="button" onClick={() => props.onBranchSwitched?.()}>stub switched</button>
      <button type="button" onClick={props.onClose}>stub close popup</button>
    </div>
  ),
}))

const makeStatus = (extra: Partial<GitRepoStatus> = {}): GitRepoStatus => ({
  repo_root: '/repo',
  branch: 'main',
  ahead: 0,
  behind: 0,
  is_detached: false,
  conflict_count: 0,
  files: [],
  ...extra,
})

const button = (name: string | RegExp) => screen.getByRole('button', { name })

describe('GitContextMenu', () => {
  it('closes on Escape and outside clicks but not on other keys or inside clicks', () => {
    const onClose = vi.fn()
    render(<GitContextMenu x={10} y={10} filePath="a.ts" isStaged={false} onClose={onClose} />)
    const menu = screen.getByRole('menu', { name: 'Git context menu' })

    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.mouseDown(menu)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('clamps its position inside the viewport', () => {
    const { unmount } = render(<GitContextMenu x={5000} y={5000} filePath="a.ts" isStaged onClose={vi.fn()} />)
    let menu = screen.getByRole('menu')
    expect(menu.style.left).toBe(`${window.innerWidth - 256 - 8}px`)
    expect(menu.style.top).toBe(`${window.innerHeight - 284 - 8}px`)
    unmount()

    render(<GitContextMenu x={-40} y={-40} filePath="a.ts" isStaged onClose={vi.fn()} />)
    menu = screen.getByRole('menu')
    expect(menu.style.left).toBe('8px')
    expect(menu.style.top).toBe('8px')
  })

  it('hides stage actions that are not allowed or not provided', () => {
    const onStage = vi.fn()
    const onUnstage = vi.fn()
    const { rerender } = render(
      <GitContextMenu x={0} y={0} filePath="a.ts" isStaged={false} canStage={false} onStage={onStage} onUnstage={onUnstage} onClose={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Stage' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unstage' })).not.toBeInTheDocument()

    rerender(<GitContextMenu x={0} y={0} filePath="a.ts" isStaged canUnstage={false} onStage={onStage} onUnstage={onUnstage} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Unstage' })).not.toBeInTheDocument()

    rerender(<GitContextMenu x={0} y={0} filePath="a.ts" isStaged onClose={vi.fn()} />)
    expect(screen.getByRole('menu').querySelectorAll('button')).toHaveLength(0)
    expect(screen.getByText('a.ts')).toBeInTheDocument()
  })
})

describe('GitWorkspaceToolbar', () => {
  const baseProps = {
    projects: [],
    selectedPath: null,
    isNotGit: false,
    repoStatus: null,
    syncing: null,
    syncNotice: null,
    activeTab: 'changes' as const,
    onSelectProject: vi.fn(),
    onToggleBranchPopup: vi.fn(),
    onSyncAction: vi.fn(),
    onChangeTab: vi.fn(),
    onClose: vi.fn(),
  }

  it('shows the empty project state without a status strip', () => {
    render(<GitWorkspaceToolbar {...baseProps} />)
    expect(screen.getByText('No workspace folder')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(button('Fetch')).toBeDisabled()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('renders sync progress, ahead/behind counters, conflicts, and notices', () => {
    const onSyncAction = vi.fn()
    const onChangeTab = vi.fn()
    render(
      <GitWorkspaceToolbar
        {...baseProps}
        projects={[{ id: 'p', name: 'Repo', path: '/repo', category: 'Workspace' }]}
        selectedPath="/repo"
        currentBranch="main"
        repoStatus={makeStatus({ ahead: 2, behind: 3, conflict_count: 1, files: [] })}
        syncing="pull"
        syncNotice="Pulling from origin"
        activeTab="maintenance"
        onSyncAction={onSyncAction}
        onChangeTab={onChangeTab}
      />,
    )
    expect(screen.getByText('Pull…')).toBeInTheDocument()
    expect(button(/^Push/)).toBeDisabled()
    expect(screen.getByText('2 ahead · ready to push')).toBeInTheDocument()
    expect(screen.getByText('3 behind · available to pull')).toBeInTheDocument()
    expect(screen.getByText('1 conflict(s) · resolve before committing')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Pulling from origin')
    expect(button(/Cleanup & Prune/)).toHaveAttribute('aria-current', 'page')
    expect(button(/^Changes & Diff/)).toHaveTextContent('0')

    fireEvent.click(button(/Cleanup & Prune/))
    fireEvent.click(button('Commit Graph'))
    expect(onChangeTab.mock.calls).toEqual([['maintenance'], ['graph']])
  })

  it('shows the status strip for a notice alone and triggers sync actions', () => {
    const onSyncAction = vi.fn()
    render(
      <GitWorkspaceToolbar
        {...baseProps}
        selectedPath="/repo"
        repoStatus={makeStatus()}
        syncNotice="fetch completed"
        onSyncAction={onSyncAction}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('fetch completed')
    expect(screen.queryByText(/ahead/)).not.toBeInTheDocument()
    fireEvent.click(button('Push'))
    expect(onSyncAction).toHaveBeenCalledWith('push')
  })
})

describe('GitCommitForm', () => {
  const formProps = {
    amend: false,
    committing: false,
    onChangeMessage: vi.fn(),
    onChangeAmend: vi.fn(),
  }

  it('flags titles longer than 72 characters and hides the counter when empty', () => {
    const { rerender } = render(<GitCommitForm {...formProps} message="" canCommit={false} onSubmit={vi.fn()} />)
    expect(screen.queryByText(/\/72$/)).not.toBeInTheDocument()

    rerender(<GitCommitForm {...formProps} message={`${'x'.repeat(80)}\nbody`} canCommit onSubmit={vi.fn()} />)
    expect(screen.getByText('80/72')).toHaveClass('text-theme-error')
    rerender(<GitCommitForm {...formProps} message="short" canCommit onSubmit={vi.fn()} />)
    expect(screen.getByText('5/72')).toHaveClass('text-theme-dim')
  })

  it('submits on Ctrl+Enter only when allowed and reports amend changes', () => {
    const onSubmit = vi.fn()
    const onChangeAmend = vi.fn()
    const { rerender } = render(
      <GitCommitForm {...formProps} message="m" canCommit={false} onChangeAmend={onChangeAmend} onSubmit={onSubmit} />,
    )
    const textarea = screen.getByLabelText('Commit message')
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()

    rerender(<GitCommitForm {...formProps} message="m" canCommit committing onChangeAmend={onChangeAmend} onSubmit={onSubmit} />)
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(button('Committing...')).toBeDisabled()

    rerender(<GitCommitForm {...formProps} message="m" canCommit onChangeAmend={onChangeAmend} onSubmit={onSubmit} />)
    fireEvent.keyDown(textarea, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Amend last commit' }))
    expect(onChangeAmend).toHaveBeenCalledWith(true)
  })
})

describe('GitBranchFooter', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('renders nothing without status or a working directory', () => {
    const { container } = render(<GitBranchFooter />)
    expect(container).toBeEmptyDOMElement()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('loads status for a working directory and reloads on refresh events', async () => {
    invoke.mockResolvedValueOnce(makeStatus({ branch: 'dev', ahead: 1 }))
    render(<GitBranchFooter cwd="/repo" />)
    expect(await screen.findByText('dev')).toBeInTheDocument()
    expect(screen.getByTitle('1 commits to push')).toHaveTextContent('1')
    expect(invoke).toHaveBeenCalledWith('git_status', { cwd: '/repo' })

    invoke.mockResolvedValueOnce(makeStatus({ branch: undefined, is_detached: true, behind: 4 }))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    })
    expect(button('Current branch: detached')).toContainElement(screen.getByTitle('4 commits to pull'))

    invoke.mockRejectedValueOnce(new Error('not a repo'))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    })
    expect(screen.queryByRole('button', { name: /Current branch/ })).not.toBeInTheDocument()
  })

  it('ignores status responses that arrive after unmount', async () => {
    let resolveStatus: (status: GitRepoStatus) => void = () => undefined
    let rejectStatus: (reason: unknown) => void = () => undefined
    invoke
      .mockReturnValueOnce(new Promise<GitRepoStatus>((resolve) => {
        resolveStatus = resolve
      }))
      .mockReturnValueOnce(new Promise<GitRepoStatus>((_resolve, reject) => {
        rejectStatus = reject
      }))
    const first = render(<GitBranchFooter cwd="/a" />)
    first.unmount()
    const second = render(<GitBranchFooter cwd="/b" />)
    second.unmount()
    await act(async () => {
      resolveStatus(makeStatus())
      rejectStatus(new Error('late'))
    })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('falls back to HEAD and toggles its own branch popup', async () => {
    const opened = vi.fn()
    const refreshed = vi.fn()
    window.addEventListener('omniterm:open-git', opened)
    window.addEventListener('omniterm:git-refresh', refreshed)
    render(<GitBranchFooter status={makeStatus({ branch: undefined })} />)

    const branch = button('Current branch: HEAD')
    fireEvent.click(branch)
    expect(screen.getByTestId('branch-popup')).toHaveAttribute('data-cwd', '/repo')
    expect(screen.getByTestId('branch-popup')).toHaveAttribute('data-branch', 'HEAD')
    fireEvent.click(button('stub expand'))
    fireEvent.click(button('stub open commit'))
    fireEvent.click(button('stub switched'))
    expect(opened).toHaveBeenCalledTimes(1)
    expect(refreshed).toHaveBeenCalledTimes(1)
    fireEvent.click(button('stub close popup'))
    expect(screen.queryByTestId('branch-popup')).not.toBeInTheDocument()

    fireEvent.contextMenu(branch)
    expect(screen.getByTestId('branch-popup')).toBeInTheDocument()
    fireEvent.click(branch)
    expect(screen.queryByTestId('branch-popup')).not.toBeInTheDocument()
    window.removeEventListener('omniterm:open-git', opened)
    window.removeEventListener('omniterm:git-refresh', refreshed)
  })

  it('uses the working directory when the status has no repository root', () => {
    invoke.mockReturnValue(new Promise(() => undefined))
    const { unmount } = render(<GitBranchFooter status={makeStatus({ repo_root: '' })} cwd="/fallback" />)
    fireEvent.click(button('Current branch: main'))
    expect(screen.getByTestId('branch-popup')).toHaveAttribute('data-cwd', '/fallback')
    unmount()

    render(<GitBranchFooter status={makeStatus({ repo_root: '' })} />)
    fireEvent.click(button('Current branch: main'))
    expect(screen.queryByTestId('branch-popup')).not.toBeInTheDocument()
  })

  it('follows controlled status updates and clears to nothing', () => {
    const { rerender } = render(<GitBranchFooter status={makeStatus({ branch: 'one' })} />)
    expect(screen.getByText('one')).toBeInTheDocument()
    rerender(<GitBranchFooter status={makeStatus({ branch: 'two' })} />)
    expect(screen.getByText('two')).toBeInTheDocument()
    rerender(<GitBranchFooter status={null} />)
    expect(screen.queryByText('two')).not.toBeInTheDocument()
  })
})
