/** @vitest-environment jsdom */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitBranchFooter } from '../GitBranchFooter'
import { GitWorkspaceView } from '../GitWorkspaceView'
import { GitWorktreeSelector } from '../GitWorktreeSelector'
import type { GitRepoStatus, GitWorktreeInfo } from '../gitTypes'
import { useGitWorktrees } from '../useGitWorktrees'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

vi.mock('../GitDiffViewer', () => ({ GitDiffViewer: () => <div data-testid="diff-viewer" /> }))

const SELECTION_KEY = 'omniterm:git-worktree-selection'

const worktree = (path: string, extra: Partial<GitWorktreeInfo> = {}): GitWorktreeInfo => ({
  path,
  branch: 'main',
  is_main: false,
  is_current: false,
  is_detached: false,
  is_bare: false,
  is_locked: false,
  is_prunable: false,
  ...extra,
})

const MAIN = worktree('D:\\repo', { is_main: true, is_current: true })
const AGENT = worktree('D:\\repo\\.claude\\worktrees\\agent', { branch: 'claude/agent' })

const status = (repoRoot: string, extra: Partial<GitRepoStatus> = {}): GitRepoStatus => ({
  repo_root: repoRoot,
  branch: 'main',
  ahead: 0,
  behind: 0,
  is_detached: false,
  files: [],
  conflict_count: 0,
  ...extra,
})

/** Answers git IPC for a repository at D:/repo whose agent worktree is checked out separately. */
function serveRepo(worktrees: GitWorktreeInfo[] = [MAIN, AGENT]) {
  invoke.mockImplementation((cmd: string, args?: { cwd?: string }) => {
    const cwd = args?.cwd ?? ''
    if (cmd === 'git_worktrees') return Promise.resolve(worktrees)
    if (cmd === 'git_status') {
      return Promise.resolve(cwd.includes('agent')
        ? status(cwd, { branch: 'claude/agent', main_worktree: 'D:\\repo' })
        : status(cwd))
    }
    return Promise.resolve([])
  })
}

const statusCwds = () => invoke.mock.calls.filter(([cmd]) => cmd === 'git_status').map(([, args]) => (args as { cwd: string }).cwd)

describe('worktree selection in the Git view', () => {
  beforeEach(() => {
    invoke.mockReset()
    localStorage.clear()
  })

  it('reviews the chosen worktree, flags it, and remembers the choice per project', async () => {
    serveRepo()
    const view = render(<GitWorkspaceView cwd="D:/repo" onClose={vi.fn()} />)

    const picker = await screen.findByRole('button', { name: 'Select worktree' })
    fireEvent.click(picker)
    const menu = screen.getByRole('dialog', { name: 'Checkouts of Active Terminal' })
    expect(within(menu).getByRole('button', { name: 'Main checkout · main' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(menu).getByRole('button', { name: 'agent · claude/agent' })).toHaveAttribute('title', AGENT.path)
    expect(screen.queryByRole('img', { name: /Linked worktree/ })).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(menu).getByRole('button', { name: 'agent · claude/agent' }))
    })
    await waitFor(() => expect(statusCwds()).toContain('D:/repo/.claude/worktrees/agent'))
    expect(screen.getByLabelText('Active Git checkout')).toHaveTextContent('Viewing changes inagentWorktreeclaude/agent')
    expect(screen.queryByRole('dialog', { name: 'Checkouts of Active Terminal' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Current branch: claude/agent' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(SELECTION_KEY) ?? '{}')).toEqual({ 'd:/repo': 'D:/repo/.claude/worktrees/agent' })

    // Reopening goes straight to the remembered worktree, without a detour through the main checkout.
    view.unmount()
    invoke.mockClear()
    render(<GitWorkspaceView cwd="D:/repo" onClose={vi.fn()} />)
    await waitFor(() => expect(statusCwds()[0]).toBe('D:/repo/.claude/worktrees/agent'))

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Back to main checkout' }))
    })
    await waitFor(() => expect(screen.queryByRole('img', { name: /Linked worktree/ })).not.toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(SELECTION_KEY) ?? '{}')).toEqual({})
    expect(screen.getByLabelText('Active Git checkout')).toHaveTextContent('Main checkout')
  })

  it('falls back to the project checkout once a remembered worktree is gone', async () => {
    localStorage.setItem(SELECTION_KEY, JSON.stringify({ 'd:/repo': 'D:/repo/.claude/worktrees/removed' }))
    serveRepo([MAIN])
    const { result } = renderHook(() => useGitWorktrees('D:/repo'))

    expect(result.current.activePath).toBe('D:/repo/.claude/worktrees/removed')
    await waitFor(() => expect(result.current.worktrees).toEqual([MAIN]))
    expect(result.current.activePath).toBe('D:/repo')
  })

  it('ignores a pruned worktree, unreadable storage and adapters without worktree support', async () => {
    localStorage.setItem(SELECTION_KEY, JSON.stringify({ 'd:/repo': 'D:/old', other: 3 }))
    const pruned = worktree('D:/old', { is_prunable: true })
    serveRepo([MAIN, pruned])
    const { result } = renderHook(() => useGitWorktrees('D:/repo'))
    await waitFor(() => expect(result.current.worktrees).toHaveLength(2))
    expect(result.current.activePath).toBe('D:/repo')

    localStorage.setItem(SELECTION_KEY, '[1]')
    invoke.mockResolvedValue(undefined)
    const empty = renderHook(() => useGitWorktrees('D:/repo'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git_worktrees', { cwd: 'D:/repo' }))
    expect(empty.result.current.worktrees).toEqual([])
    expect(empty.result.current.activePath).toBe('D:/repo')

    invoke.mockRejectedValue(new Error('not a repository'))
    const failed = renderHook(() => useGitWorktrees('D:/elsewhere'))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    })
    expect(failed.result.current.worktrees).toEqual([])
    expect(renderHook(() => useGitWorktrees(null)).result.current.activePath).toBeNull()
  })

  it('stores a worktree picked from inside a linked checkout and forgets the project own checkout', async () => {
    const linkedProject = worktree('D:\\repo\\.claude\\worktrees\\agent', { branch: 'claude/agent', is_current: true })
    serveRepo([{ ...MAIN, is_current: false }, linkedProject])
    const { result } = renderHook(() => useGitWorktrees('D:/repo/.claude/worktrees/agent/src'))
    await waitFor(() => expect(result.current.worktrees).toHaveLength(2))

    act(() => result.current.selectWorktree(MAIN.path))
    expect(result.current.activePath).toBe('D:/repo')
    act(() => result.current.selectWorktree(linkedProject.path))
    expect(localStorage.getItem(SELECTION_KEY)).toBe('{}')
    expect(result.current.activePath).toBe('D:/repo/.claude/worktrees/agent/src')
  })
})

describe('GitWorktreeSelector', () => {
  it('stays hidden for a single worktree and labels detached, bare and missing ones', () => {
    const { container, rerender } = render(<GitWorktreeSelector worktrees={[MAIN]} activePath="D:/repo" onSelectWorktree={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()

    const onSelect = vi.fn()
    rerender(<GitWorktreeSelector
      worktrees={[
        worktree('/srv/repo.git', { is_main: true, is_bare: true, branch: undefined }),
        worktree('/srv/wt/fix', { branch: undefined, is_detached: true, head: '0123456789abcdef', is_current: true }),
        worktree('/srv/wt/gone', { branch: undefined, is_prunable: true }),
      ]}
      activePath="/elsewhere"
      onSelectWorktree={onSelect}
    />)
    const picker = screen.getByRole('button', { name: 'Select worktree' })
    expect(picker).toHaveTextContent('fix')
    fireEvent.click(picker)
    const menu = screen.getByRole('dialog', { name: 'Repository checkouts' })
    expect(within(menu).getByRole('button', { name: 'fix · Detached HEAD · 0123456' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(menu).getByRole('button', { name: 'gone · Detached HEAD' })).toBeDisabled()
    expect(within(menu).getByText('Folder missing')).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('button', { name: 'Main checkout · Bare repository' }))
    expect(onSelect).toHaveBeenCalledWith('/srv/repo.git')
  })
})

describe('GitBranchFooter worktree indicator', () => {
  beforeEach(() => invoke.mockReset())

  it('marks a linked worktree with an icon next to the branch', async () => {
    const { rerender } = render(<GitBranchFooter status={status('D:/repo', { branch: 'dev' })} />)
    expect(screen.getByRole('button', { name: 'Current branch: dev' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Linked worktree/ })).not.toBeInTheDocument()

    rerender(<GitBranchFooter status={status('D:/repo/.claude/worktrees/agent', { branch: 'claude/agent', main_worktree: 'D:/repo' })} />)
    const branch = await screen.findByRole('button', { name: 'Current branch: claude/agent (linked worktree)' })
    const badge = within(branch).getByRole('img', { name: 'Linked worktree of D:/repo' })
    expect(badge).toHaveClass('is-compact')
    expect(badge).not.toHaveTextContent('Worktree')
  })
})
