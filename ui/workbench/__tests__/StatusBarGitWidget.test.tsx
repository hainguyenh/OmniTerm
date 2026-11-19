/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ git: null as null | Record<string, unknown>, focus: vi.fn(() => Promise.resolve()), popup: vi.fn() }))

vi.mock('../useFooterGit', () => ({ useFooterGit: () => h.git }))
vi.mock('../../ide/features/vcs/store', () => ({ focusRepo: h.focus }))
vi.mock('../../ide/features/vcs/BranchWidget', () => ({ showBranchesPopupFromStatus: h.popup }))

import { StatusBarGitWidget } from '../StatusBarGitWidget'
import { registerStatusBarWidgets } from '../registerStatusBarWidgets'

describe('StatusBarGitWidget', () => {
  beforeEach(() => {
    h.git = { root: 'D:/p', repo: 'p', head: 'main', headCommit: null, ahead: 2, behind: 0, inProject: true }
    h.focus.mockClear()
    h.popup.mockClear()
  })
  afterEach(cleanup)

  it('shows the branch with its outgoing count', () => {
    render(<StatusBarGitWidget />)
    expect(screen.getByTestId('status-bar-git-widget').textContent).toContain('main')
    expect(screen.getByTestId('status-bar-git-widget').textContent).toContain('↑2')
  })

  it('renders nothing without a repository', () => {
    h.git = null
    render(<StatusBarGitWidget />)
    expect(screen.queryByTestId('status-bar-git-widget')).toBeNull()
  })

  it('opens the Branches popup on a project repository', async () => {
    render(<StatusBarGitWidget />)
    fireEvent.click(screen.getByTestId('status-bar-git-widget'))
    await Promise.resolve()
    await Promise.resolve()
    expect(h.focus).toHaveBeenCalledWith('D:/p')
    expect(h.popup).toHaveBeenCalled()
  })

  it('does not open the popup for a repository outside the project', () => {
    h.git = { ...h.git, inProject: false }
    render(<StatusBarGitWidget />)
    fireEvent.click(screen.getByTestId('status-bar-git-widget'))
    expect(h.focus).not.toHaveBeenCalled()
  })

  it('is registered in the status bar', () => {
    expect(typeof registerStatusBarWidgets).toBe('function')
  })
})
