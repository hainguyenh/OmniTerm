/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitBranchQuickPopover } from '../GitBranchQuickPopover'
import type { GitBranchInfo } from '../gitTypes'

const mockBranches: GitBranchInfo[] = [
  {
    name: 'main',
    is_current: true,
    is_remote: false,
    upstream: 'origin/main',
    ahead: 2,
    behind: 1,
    is_gone: false,
  },
  {
    name: 'features/smart-pull',
    is_current: false,
    is_remote: false,
    upstream: 'origin/features/smart-pull',
    ahead: 0,
    behind: 1,
    is_gone: false,
  },
  {
    name: 'origin/develop',
    is_current: false,
    is_remote: true,
    ahead: 0,
    behind: 0,
    is_gone: false,
  },
]

const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
  if (cmd === 'git_branches') {
    return Promise.resolve(mockBranches)
  }
  if (cmd === 'git_pull') {
    return Promise.resolve('Already up to date')
  }
  if (cmd === 'git_update_branch') {
    return Promise.resolve('Updated branch features/smart-pull')
  }
  if (cmd === 'git_fetch') {
    return Promise.resolve('Fetched')
  }
  return Promise.resolve(null)
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

describe('GitBranchQuickPopover', () => {
  beforeEach(() => {
    mockInvoke.mockClear()
  })

  it('renders quick view with search and branches tree', async () => {
    const onClose = vi.fn()
    const onExpand = vi.fn()
    await act(async () => {
      render(
        <GitBranchQuickPopover
          cwd="/test/repo"
          currentBranch="main"
          onClose={onClose}
          onExpand={onExpand}
        />,
      )
    })

    expect(screen.getByTestId('branch-quick-popover')).toBeInTheDocument()
    expect(screen.getByText('repo')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Find branch…')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Branch main, current branch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Branch features/smart-pull' })).toBeInTheDocument()
  })

  it('calls onExpand when clicking the expand button', async () => {
    const onClose = vi.fn()
    const onExpand = vi.fn()
    await act(async () => {
      render(
        <GitBranchQuickPopover
          cwd="/test/repo"
          currentBranch="main"
          onClose={onClose}
          onExpand={onExpand}
        />,
      )
    })

    const expandBtn = screen.getByRole('button', { name: 'Open full branch manager' })
    fireEvent.click(expandBtn)
    expect(onClose).toHaveBeenCalled()
    expect(onExpand).toHaveBeenCalled()
  })

  it('supports right-click to open context menu and pull current branch', async () => {
    const onClose = vi.fn()
    const onExpand = vi.fn()
    await act(async () => {
      render(
        <GitBranchQuickPopover
          cwd="/test/repo"
          currentBranch="main"
          onClose={onClose}
          onExpand={onExpand}
        />,
      )
    })

    const mainBtn = await screen.findByRole('button', { name: 'Branch main, current branch' })
    fireEvent.contextMenu(mainBtn)

    const pullBtn = within(await screen.findByRole('dialog', { name: 'Actions for main' })).getByRole('button', { name: 'Pull' })
    expect(pullBtn).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(pullBtn)
    })
    expect(mockInvoke).toHaveBeenCalledWith('git_pull', { cwd: '/test/repo', rebase: false })
  })

  it('supports right-click to open context menu and pull tracked branch without checkout', async () => {
    const onClose = vi.fn()
    const onExpand = vi.fn()
    await act(async () => {
      render(
        <GitBranchQuickPopover
          cwd="/test/repo"
          currentBranch="main"
          onClose={onClose}
          onExpand={onExpand}
        />,
      )
    })

    const otherBranchBtn = await screen.findByRole('button', { name: 'Branch features/smart-pull' })
    fireEvent.contextMenu(otherBranchBtn)

    const pullBtn = within(await screen.findByRole('dialog', { name: 'Actions for features/smart-pull' })).getByRole('button', { name: 'Pull' })
    expect(pullBtn).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(pullBtn)
    })
    expect(mockInvoke).toHaveBeenCalledWith('git_update_branch', { cwd: '/test/repo', branch: 'features/smart-pull' })
  })

  it('shows why a delete was refused instead of failing silently', async () => {
    const fallback = mockInvoke.getMockImplementation()
    mockInvoke.mockImplementation((cmd: string, args?: unknown) => cmd === 'git_delete_branches'
      ? Promise.resolve({ deleted: [], failed: [{ branch: 'features/smart-pull', reason: "The branch 'features/smart-pull' is not fully merged" }] })
      : fallback?.(cmd, args))
    await act(async () => {
      render(<GitBranchQuickPopover cwd="/test/repo" currentBranch="main" onClose={vi.fn()} onExpand={vi.fn()} />)
    })

    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Branch features/smart-pull' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete branch…' }))
    })
    expect(mockInvoke).toHaveBeenCalledWith('git_delete_branches', { cwd: '/test/repo', branches: ['features/smart-pull'], force: false, removeWorktrees: false })
    const dialog = screen.getByRole('dialog', { name: 'Delete features/smart-pull' })
    expect(dialog).toHaveTextContent('not fully merged')

    // Escape closes the delete dialog, not the popover underneath it.
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Delete features/smart-pull' })).not.toBeInTheDocument()
    expect(screen.getByTestId('branch-quick-popover')).toBeInTheDocument()
    mockInvoke.mockImplementation(fallback ?? (() => Promise.resolve(null)))
  })

  it('closes on Escape key', async () => {
    const onClose = vi.fn()
    const onExpand = vi.fn()
    await act(async () => {
      render(
        <GitBranchQuickPopover
          cwd="/test/repo"
          currentBranch="main"
          onClose={onClose}
          onExpand={onExpand}
        />,
      )
    })

    const popover = screen.getByTestId('branch-quick-popover')
    fireEvent.keyDown(popover, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
