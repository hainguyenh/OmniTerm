/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitBranchPopup } from '../GitBranchPopup'
import { GitBranchSubmenu } from '../GitBranchSubmenu'
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
    name: 'features/smart-merge',
    is_current: false,
    is_remote: false,
    upstream: undefined,
    ahead: 0,
    behind: 0,
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
  if (cmd === 'git_push') {
    return Promise.resolve('Everything up-to-date')
  }
  if (cmd === 'git_checkout') {
    return Promise.resolve('Switched to branch')
  }
  if (cmd === 'git_create_branch') {
    return Promise.resolve('Branch created')
  }
  if (cmd === 'git_merge') {
    return Promise.resolve('Merge complete')
  }
  if (cmd === 'git_rebase') {
    return Promise.resolve('Rebase complete')
  }
  if (cmd === 'git_init') {
    return Promise.resolve('Initialized empty Git repository')
  }
  return Promise.resolve(null)
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

describe('GitBranchSubmenu', () => {
  it('renders menu items and calls checkout, merge, and rebase callbacks', () => {
    const onCheckout = vi.fn()
    const onMerge = vi.fn()
    const onRebase = vi.fn()
    const onNewBranchFrom = vi.fn()
    const onClose = vi.fn()

    render(
      <GitBranchSubmenu
        branch={mockBranches[1]}
        currentBranch="main"
        onCheckout={onCheckout}
        onMerge={onMerge}
        onRebase={onRebase}
        onNewBranchFrom={onNewBranchFrom}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('features/smart-merge')).toBeInTheDocument()
    expect(screen.getByText('Checkout')).toBeInTheDocument()
    expect(screen.getByText("Merge 'features/smart-merge' into 'main'")).toBeInTheDocument()

    fireEvent.click(screen.getByText('Checkout'))
    expect(onCheckout).toHaveBeenCalledWith('features/smart-merge')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('GitBranchPopup', () => {
  beforeEach(() => {
    mockInvoke.mockClear()
  })

  it('renders branches in tree view and allows toggling to flat view', async () => {
    await act(async () => {
      render(
        <GitBranchPopup
          cwd="/repo"
          currentBranch="main"
          onClose={vi.fn()}
        />,
      )
    })

    const browser = screen.getByRole('region', { name: 'Branch browser' })
    expect(within(browser).getByRole('button', { name: 'Branch main, current branch' })).toBeInTheDocument()
    // Tree view shows folder 'features' and branch leaf 'smart-merge'
    expect(within(browser).getByRole('button', { name: 'Collapse branch folder features' })).toBeInTheDocument()
    const treeLeaf = within(browser).getByRole('button', { name: 'Branch features/smart-merge' })
    expect(treeLeaf).toHaveTextContent(/^smart-merge$/)

    // Toggle to flat view
    act(() => {
      fireEvent.click(within(browser).getByRole('button', { name: 'List' }))
    })
    expect(within(browser).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(browser).queryByRole('button', { name: /branch folder features/ })).not.toBeInTheDocument()
    expect(within(browser).getByRole('button', { name: 'Branch features/smart-merge' })).toHaveTextContent(/^features\/smart-merge$/)

    // Filter branches
    act(() => {
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search branches' }), { target: { value: 'smart' } })
    })

    expect(within(browser).getByRole('button', { name: 'Branch features/smart-merge' })).toBeInTheDocument()
    expect(within(browser).queryByRole('button', { name: 'Branch origin/develop' })).not.toBeInTheDocument()
    expect(within(browser).queryByRole('button', { name: /^Branch main/ })).not.toBeInTheDocument()
  })

  it('opens Branch Cleanup in the Git view when clicking cleanup action', async () => {
    const onClose = vi.fn()
    const openGit = vi.fn()
    const openMaintenance = vi.fn()
    window.addEventListener('omniterm:open-git', openGit)
    window.addEventListener('omniterm:open-git-maintenance', openMaintenance)
    await act(async () => {
      render(
        <GitBranchPopup
          cwd="/repo"
          currentBranch="main"
          onClose={onClose}
        />,
      )
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cleanup & prune' }))
    })

    // Cleanup lives in the Git view's maintenance tab; the popup hands over to it and closes.
    expect(localStorage.getItem('omniterm:git-active-tab')).toBe('maintenance')
    expect(openGit).toHaveBeenCalledTimes(1)
    expect(openMaintenance).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
    window.removeEventListener('omniterm:open-git', openGit)
    window.removeEventListener('omniterm:open-git-maintenance', openMaintenance)
  })

  it('triggers update project (pull) and push actions', async () => {
    await act(async () => {
      render(
        <GitBranchPopup
          cwd="/repo"
          currentBranch="main"
          onClose={vi.fn()}
        />,
      )
    })

    const footer = document.querySelector('.git-branches-footer') as HTMLElement
    const updateBtn = within(footer).getByRole('button', { name: 'Pull current' })
    await act(async () => {
      fireEvent.click(updateBtn)
    })
    expect(mockInvoke).toHaveBeenCalledWith('git_pull', expect.objectContaining({ cwd: '/repo' }))

    const pushBtn = within(footer).getByRole('button', { name: 'Push current' })
    await act(async () => {
      fireEvent.click(pushBtn)
    })
    expect(mockInvoke).toHaveBeenCalledWith('git_push', expect.objectContaining({ cwd: '/repo' }))
  })

  it('allows creating a new branch and checking it out', async () => {
    await act(async () => {
      render(
        <GitBranchPopup
          cwd="/repo"
          currentBranch="main"
          onClose={vi.fn()}
        />,
      )
    })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'New branch' }))
    })

    const nameInput = screen.getByRole('textbox', { name: /Create from main/ })
    act(() => {
      fireEvent.change(nameInput, { target: { value: 'fix/login-bug' } })
    })

    const createSubmit = screen.getByRole('button', { name: 'Create & checkout' })
    await act(async () => {
      fireEvent.click(createSubmit)
    })

    expect(mockInvoke).toHaveBeenCalledWith('git_create_branch', expect.objectContaining({
      cwd: '/repo',
      name: 'fix/login-bug',
      startPoint: 'main',
      checkout: true,
    }))
  })

  it('shows not-a-git-repo message and initializes repo when requested', async () => {
    mockInvoke.mockImplementationOnce(() => Promise.reject(new Error('Not a git repository')))

    await act(async () => {
      render(
        <GitBranchPopup
          cwd="/not-git"
          currentBranch={undefined}
          onClose={vi.fn()}
        />,
      )
    })

    expect(screen.getByRole('heading', { name: 'Not a Git repository' })).toBeInTheDocument()
    const initBtn = screen.getByRole('button', { name: 'Initialize repository' })
    await act(async () => {
      fireEvent.click(initBtn)
    })
    expect(mockInvoke).toHaveBeenCalledWith('git_init', { cwd: '/not-git' })
  })
})
