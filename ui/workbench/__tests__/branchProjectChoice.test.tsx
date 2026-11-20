/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BranchWidget, BranchesPopupHost, useBranchesPopup } from '../../ide/features/vcs/BranchWidget'
import { chosenBranchProject, useBranchProject } from '../../ide/features/vcs/branchProject'
import { useVcs } from '../../ide/features/vcs/store'
import { useWorkspaceStore } from '../../platform/workspaceStore'

// The popup loads branches and tags over IPC: there are none in these tests.
vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve([]) }))

const A = 'D:/ws/a'
const B = 'D:/ws/b'
const branch = { head: 'main', headCommit: '1', upstream: null, ahead: 0, behind: 0, operation: null }

beforeEach(() => {
  localStorage.clear()
  useBranchProject.setState({ root: null, against: null, collapsed: false })
  useBranchesPopup.setState({ open: false, fromStatus: false })
  useVcs.setState({
    available: true,
    branch,
    root: 'D:/ws',
    roots: [A, B],
    repo: A,
    heads: { [A]: { head: 'main', headCommit: '1' }, [B]: { head: 'feature/x', headCommit: '2' } },
  } as never)
  useWorkspaceStore.setState({
    workspaces: [
      {
        id: 'w1',
        name: 'ws',
        order: 0,
        pins: [],
        folders: [
          { id: 'fa', name: 'a', path: A },
          { id: 'fb', name: 'b', path: B },
        ],
      },
    ],
    selection: 'w1::fa',
  } as never)
})

afterEach(cleanup)

describe('chosenBranchProject', () => {
  it('holds while the default project it was chosen against stays the default', () => {
    expect(chosenBranchProject({ root: B, against: A }, A, [A, B])).toBe(B)
    expect(chosenBranchProject({ root: B, against: A }, B, [A, B])).toBeNull()
    expect(chosenBranchProject({ root: B, against: A }, A, [A])).toBeNull()
    expect(chosenBranchProject({ root: null, against: A }, A, [A, B])).toBeNull()
  })
})

describe('Branches popup project choice', () => {
  it('lists every project with its branch, the default one chosen', () => {
    useBranchesPopup.setState({ open: true })
    render(<BranchesPopupHost />)
    const group = screen.getByRole('radiogroup', { name: 'Project the branch widget shows' })
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(radios).toHaveLength(2)
    expect(radios.map((r) => r.checked)).toEqual([true, false])
    expect(within(group).getByText('feature/x')).toBeTruthy()
  })

  it('choosing a project makes the title widget show it and selects its repository', () => {
    useBranchesPopup.setState({ open: true })
    render(
      <>
        <BranchWidget />
        <BranchesPopupHost />
      </>,
    )
    const group = screen.getByRole('radiogroup', { name: 'Project the branch widget shows' })
    act(() => fireEvent.click(within(group).getAllByRole('radio')[1]!))

    expect(useBranchProject.getState()).toMatchObject({ root: B, against: A })
    expect(useVcs.getState().repo).toBe(B)
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.checked)).toEqual([false, true])
    const widget = document.querySelector('[data-branches-widget]')!
    expect(widget.textContent).toContain('b')
  })

  it('choosing the default project keeps the widget on it, not on the active file', () => {
    useBranchProject.setState({ root: B, against: A })
    useBranchesPopup.setState({ open: true })
    render(<BranchesPopupHost />)
    const group = screen.getByRole('radiogroup', { name: 'Project the branch widget shows' })
    act(() => fireEvent.click(within(group).getAllByRole('radio')[0]!))
    expect(useBranchProject.getState()).toMatchObject({ root: A, against: A })
    expect(useVcs.getState().repo).toBe(A)
    expect((within(group).getAllByRole('radio') as HTMLInputElement[]).map((r) => r.checked)).toEqual([true, false])
  })

  it('a choice made against another default project no longer applies', () => {
    useBranchProject.setState({ root: B, against: A })
    useWorkspaceStore.setState({ selection: 'w1::fb' } as never)
    useBranchesPopup.setState({ open: true })
    render(<BranchesPopupHost />)
    const group = screen.getByRole('radiogroup', { name: 'Project the branch widget shows' })
    // The new default project (b) is shown, and selected.
    expect((within(group).getAllByRole('radio') as HTMLInputElement[]).map((r) => r.checked)).toEqual([false, true])
    expect(useVcs.getState().repo).toBe(B)
  })

  it('folds to its header and remembers it', () => {
    useBranchesPopup.setState({ open: true })
    render(<BranchesPopupHost />)
    const header = screen.getByRole('button', { name: /Projects/ })
    act(() => fireEvent.click(header))
    expect(screen.queryByRole('radiogroup', { name: 'Project the branch widget shows' })).toBeNull()
    expect(localStorage.getItem('omniterm.vcs.branchProjectsCollapsed')).toBe('true')
  })
})
