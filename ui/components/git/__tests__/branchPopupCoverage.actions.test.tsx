/** @vitest-environment jsdom */
import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { takePendingFileDiff } from '../gitFileDiffRequest'
import { MAIN, REMOTE, TOPIC, answerInvoke, mockInvoke, renderPopup } from './branchPopupCoverage.fixtures'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}))

const COMPARISON = {
  base_branch: 'main',
  target_branch: 'feature/topic',
  commits_ahead: [],
  commits_behind: [],
  files: [{ path: 'src/app.ts', staged: 'modified', unstaged: 'unmodified', is_conflicted: false }],
}

function browser() {
  return screen.getByRole('region', { name: 'Branch browser' })
}

function inspector() {
  return screen.getByRole('complementary', { name: 'Selected branch details' })
}

function selectTopic() {
  fireEvent.click(within(browser()).getByRole('button', { name: 'Branch feature/topic' }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GitBranchPopup branch actions', () => {
  it('deletes a branch safely, refreshes the Git view, and resets the selection', async () => {
    answerInvoke([MAIN, TOPIC], { git_delete_branches: () => ({ deleted: ['feature/topic'], failed: [] }) })
    const onRefresh = vi.fn()
    window.addEventListener('omniterm:git-refresh', onRefresh)
    await renderPopup()

    selectTopic()
    await act(async () => { fireEvent.click(within(inspector()).getByRole('button', { name: 'Delete branch…' })) })
    expect(mockInvoke).toHaveBeenCalledWith('git_delete_branches', { cwd: '/work/repo', branches: ['feature/topic'], force: false, removeWorktrees: false })
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(within(inspector()).getByRole('heading', { name: 'main' })).toBeInTheDocument()
    window.removeEventListener('omniterm:git-refresh', onRefresh)
  })

  it('keeps the selection and shows why when git refuses the delete', async () => {
    answerInvoke([MAIN, TOPIC], {
      git_delete_branches: ({ force }) => force
        ? { deleted: ['feature/topic'], failed: [] }
        : { deleted: [], failed: [{ branch: 'feature/topic', reason: "The branch 'feature/topic' is not fully merged" }] },
    })
    const onRefresh = vi.fn()
    window.addEventListener('omniterm:git-refresh', onRefresh)
    await renderPopup()

    selectTopic()
    await act(async () => { fireEvent.click(within(inspector()).getByRole('button', { name: 'Delete branch…' })) })
    expect(onRefresh).not.toHaveBeenCalled()
    expect(within(inspector()).getByRole('heading', { name: 'feature/topic' })).toBeInTheDocument()
    const dialog = screen.getByRole('dialog', { name: 'Delete feature/topic' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('not fully merged')

    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Force delete' })) })
    expect(mockInvoke).toHaveBeenCalledWith('git_delete_branches', { cwd: '/work/repo', branches: ['feature/topic'], force: true, removeWorktrees: false })
    expect(screen.queryByRole('dialog', { name: 'Delete feature/topic' })).not.toBeInTheDocument()
    expect(onRefresh).toHaveBeenCalledTimes(1)
    window.removeEventListener('omniterm:git-refresh', onRefresh)
  })

  it('confirms before deleting a branch held by an agent worktree', async () => {
    answerInvoke([MAIN, TOPIC], {
      git_worktrees: () => [
        { path: '/work/repo', branch: 'main', is_main: true, is_current: true, is_detached: false, is_bare: false, is_locked: false, is_prunable: false },
        { path: '/work/repo/.claude/worktrees/topic', branch: 'feature/topic', is_main: false, is_current: false, is_detached: false, is_bare: false, is_locked: false, is_prunable: false },
      ],
      git_delete_branches: () => ({ deleted: ['feature/topic'], failed: [], removed_worktrees: ['/work/repo/.claude/worktrees/topic'] }),
    })
    await renderPopup()

    selectTopic()
    await act(async () => { fireEvent.click(within(inspector()).getByRole('button', { name: 'Delete branch…' })) })
    const dialog = screen.getByRole('dialog', { name: 'Delete feature/topic' })
    expect(within(dialog).getByRole('note')).toHaveTextContent('/work/repo/.claude/worktrees/topic')
    expect(mockInvoke).not.toHaveBeenCalledWith('git_delete_branches', expect.anything())

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Delete feature/topic' })).not.toBeInTheDocument()

    await act(async () => { fireEvent.click(within(inspector()).getByRole('button', { name: 'Delete branch…' })) })
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete feature/topic' })).getByRole('button', { name: 'Delete' })) })
    expect(mockInvoke).toHaveBeenCalledWith('git_delete_branches', { cwd: '/work/repo', branches: ['feature/topic'], force: false, removeWorktrees: true })
    expect(screen.getByText("Deleted 'feature/topic' and its worktree")).toBeInTheDocument()
  })

  it('resets the selection after a rename and keeps it after a refusal', async () => {
    let refuse = true
    answerInvoke([MAIN, TOPIC], {
      git_rename_branch: () => {
        if (refuse) throw new Error('name taken')
        return 'Renamed'
      },
    })
    await renderPopup()

    selectTopic()
    fireEvent.click(within(inspector()).getByText('More branch tools'))
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Rename branch' }))
    fireEvent.change(within(inspector()).getByLabelText('New branch name'), { target: { value: 'feature/next' } })
    await act(async () => { fireEvent.click(within(inspector()).getByRole('button', { name: 'Rename' })) })
    expect(within(inspector()).getByRole('alert')).toHaveTextContent('name taken')
    expect(within(inspector()).getByRole('heading', { name: 'feature/topic' })).toBeInTheDocument()

    refuse = false
    await act(async () => { fireEvent.click(within(inspector()).getByRole('button', { name: 'Rename' })) })
    expect(mockInvoke).toHaveBeenLastCalledWith('git_branches', { cwd: '/work/repo' })
    expect(within(inspector()).getByRole('heading', { name: 'main' })).toBeInTheDocument()
  })

  it('closes after opening a worktree but stays open when git refuses', async () => {
    let refuse = true
    answerInvoke([MAIN, TOPIC], {
      git_add_worktree: () => {
        if (refuse) throw new Error('already checked out')
        return '/work/repo.worktrees/topic'
      },
    })
    const { onClose } = await renderPopup()

    selectTopic()
    fireEvent.click(within(inspector()).getByText('More branch tools'))
    const open = within(inspector()).getByRole('button', { name: 'Open in worktree' })
    await act(async () => { fireEvent.click(open) })
    expect(within(inspector()).getByRole('alert')).toHaveTextContent('already checked out')
    expect(onClose).not.toHaveBeenCalled()

    refuse = false
    await act(async () => { fireEvent.click(open) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pulls the selected branch in place straight from the inspector', async () => {
    answerInvoke([MAIN, TOPIC], { git_update_branch: () => "Fast-forwarded 'feature/topic' to origin/topic" })
    await renderPopup()

    selectTopic()
    await act(async () => { fireEvent.click(within(inspector()).getByRole('button', { name: 'Pull feature/topic' })) })
    expect(mockInvoke).toHaveBeenCalledWith('git_update_branch', { cwd: '/work/repo', branch: 'feature/topic' })
    expect(mockInvoke).not.toHaveBeenCalledWith('git_checkout', expect.anything())
    expect(screen.getByText("Fast-forwarded 'feature/topic' to origin/topic")).toBeInTheDocument()
  })

  it('starts a branch from a remote branch through the context menu', async () => {
    answerInvoke([MAIN, REMOTE])
    await renderPopup()

    fireEvent.contextMenu(within(browser()).getByRole('button', { name: 'Branch origin/main' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Actions for origin/main' })).getByRole('button', { name: 'New branch…' }))
    expect(screen.getByRole('textbox', { name: /Create from origin\/main/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: /Create from/ })).not.toBeInTheDocument()
  })
})

describe('GitBranchPopup compare', () => {
  it('hands a compared file to the host and ignores popup keys meanwhile', async () => {
    answerInvoke([MAIN, TOPIC], { git_compare_branches: () => COMPARISON })
    const onOpenFileDiff = vi.fn()
    const { onClose } = await renderPopup({ onOpenFileDiff })

    selectTopic()
    await act(async () => { fireEvent.click(within(inspector()).getByRole('button', { name: 'Compare…' })) })
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Git Branches' }), { key: 'Tab' })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'View diff for src/app.ts' }))
    expect(onOpenFileDiff).toHaveBeenCalledWith('src/app.ts', 'feature/topic')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'View diff for src/app.ts' })).not.toBeInTheDocument()
  })

  it('parks the file diff for the Git view when no host handler is given', async () => {
    answerInvoke([MAIN, TOPIC], { git_compare_branches: () => COMPARISON })
    const openGit = vi.fn()
    window.addEventListener('omniterm:open-git', openGit)
    await renderPopup({ currentBranch: undefined })

    selectTopic()
    await act(async () => { fireEvent.click(within(inspector()).getByRole('button', { name: 'Compare…' })) })
    expect(mockInvoke).toHaveBeenCalledWith('git_compare_branches', { cwd: '/work/repo', baseBranch: 'HEAD', targetBranch: 'feature/topic' })
    fireEvent.click(screen.getByRole('button', { name: 'View diff for src/app.ts' }))
    expect(openGit).toHaveBeenCalledTimes(1)
    expect(takePendingFileDiff()).toEqual({ path: 'src/app.ts', targetBranch: 'feature/topic' })
    window.removeEventListener('omniterm:open-git', openGit)
  })

  it('closes the comparison without leaving the popup', async () => {
    answerInvoke([MAIN, TOPIC], { git_compare_branches: () => COMPARISON })
    const { onClose } = await renderPopup()

    selectTopic()
    await act(async () => { fireEvent.click(within(inspector()).getByRole('button', { name: 'Compare…' })) })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('src/app.ts')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('GitBranchPopup footer and notices', () => {
  it('opens the commit view and closes', async () => {
    answerInvoke([MAIN])
    const onOpenCommit = vi.fn()
    const { onClose } = await renderPopup({ onOpenCommit })

    fireEvent.click(screen.getByRole('button', { name: 'Commit…' }))
    expect(onOpenCommit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('still opens maintenance when storage is unavailable', async () => {
    answerInvoke([MAIN])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const openMaintenance = vi.fn()
    window.addEventListener('omniterm:open-git-maintenance', openMaintenance)
    const { onClose } = await renderPopup()

    fireEvent.click(screen.getByRole('button', { name: 'Cleanup & prune' }))
    expect(openMaintenance).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    window.removeEventListener('omniterm:open-git-maintenance', openMaintenance)
  })

  it('shows the running action, disables controls, then reports failures as errors', async () => {
    let rejectFetch: (reason: Error) => void = () => undefined
    answerInvoke([MAIN], { git_fetch: () => new Promise((_resolve, reject) => { rejectFetch = reject }) })
    await renderPopup()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fetch Remotes' })) })
    expect(screen.getByText('Fetching remotes...')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'Fetch Remotes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Push current' })).toBeDisabled()

    await act(async () => { rejectFetch(new Error('offline')) })
    const notice = screen.getByText('Fetch failed: Error: offline')
    expect(notice).toHaveClass('is-error')
    expect(screen.queryByText('Fetching remotes...')).not.toBeInTheDocument()
  })

  it('initializes a folder that is not a repository', async () => {
    answerInvoke([], { git_branches: () => { throw new Error('not a repository') } })
    await renderPopup()

    expect(screen.getByRole('button', { name: 'Pull current' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cleanup & prune' })).toBeDisabled()
    answerInvoke([MAIN])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Initialize repository' })) })
    expect(screen.getByText('Initialized empty Git repository')).not.toHaveClass('is-error')
    expect(screen.getByRole('region', { name: 'Branch browser' })).toBeInTheDocument()
  })
})
