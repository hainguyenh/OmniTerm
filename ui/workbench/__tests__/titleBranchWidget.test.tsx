/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { BranchWidget, useBranchesPopup } from '../../ide/features/vcs/BranchWidget'
import { useVcs } from '../../ide/features/vcs/store'
import { useWorkspaceStore } from '../../platform/workspaceStore'

const branch = { head: 'feature/title-bar', headCommit: null, upstream: null, ahead: 1, behind: 0, operation: null }

describe('title bar branch widget', () => {
  beforeEach(() => {
    useBranchesPopup.setState({ open: false, fromStatus: false })
    useVcs.setState({ available: true, branch })
  })

  it('names the current branch', () => {
    render(<BranchWidget />)
    expect(screen.getByText('feature/title-bar')).toBeTruthy()
  })

  it('opens the same Branches popup below the title bar', () => {
    const { container } = render(<BranchWidget />)
    fireEvent.click(container.querySelector('[data-branches-widget]')!)
    expect(useBranchesPopup.getState()).toMatchObject({ open: true, fromStatus: false })
  })

  it('renders nothing while the project has no repository', () => {
    useVcs.setState({ available: false })
    const { container } = render(<BranchWidget />)
    expect(container.querySelector('[data-branches-widget]')).toBeNull()
  })

  it('follows the default project: choosing another project selects its repository', () => {
    useVcs.setState({ available: true, branch, roots: ['D:/ws/a', 'D:/ws/b'], repo: 'D:/ws/a' } as never)
    useWorkspaceStore.setState({
      workspaces: [{ id: 'w1', name: 'ws', order: 0, pins: [], folders: [{ id: 'fa', name: 'a', path: 'D:/ws/a' }, { id: 'fb', name: 'b', path: 'D:/ws/b' }] }],
      selection: 'w1::fb',
    } as never)
    render(<BranchWidget />)
    expect(useVcs.getState().repo).toBe('D:/ws/b')
  })
})
