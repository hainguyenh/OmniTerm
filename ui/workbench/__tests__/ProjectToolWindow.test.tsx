/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ide/features/project-tree/ProjectView', () => ({
  ProjectView: () => <div data-testid="upstream-project-view">ProjectViewMock</div>,
}))

const workspaceActions = vi.hoisted(() => ({
  addFolderToWorkspace: vi.fn().mockResolvedValue(undefined),
  addWorkspaceFromFolder: vi.fn().mockResolvedValue(undefined),
  exportWorkspaceFile: vi.fn().mockResolvedValue(undefined),
  activeFolders: (workspace?: { folders: Array<{ disabled?: boolean }> } | null) => (workspace?.folders ?? []).filter((folder) => !folder.disabled),
}))
vi.mock('../titlebar/workspaceActions', () => workspaceActions)

import { useProjectTree } from '../../ide/features/project-tree/store'
import { useContributions } from '../../ide/workbench/contributions'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { ProjectToolWindow } from '../ProjectToolWindow'
import { registerShellToolWindows } from '../registerShellToolWindows'
import { useTreeViewport } from './treeViewport'

describe('ProjectToolWindow', () => {
  useTreeViewport()

  beforeEach(() => {
    act(() => {
      useProjectTree.setState({ root: null })
      useWorkspaceStore.setState({ workspaces: [], selection: null })
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => {
      useProjectTree.setState({ root: null })
    })
  })

  it('renders the empty state with an open folder button when no workspace is open', () => {
    render(<ProjectToolWindow />)

    expect(screen.getByTestId('project-empty-state')).toBeTruthy()
    expect(screen.getByText('No workspace is open')).toBeTruthy()
    expect(screen.getByTestId('project-open-folder-button').textContent).toBe('Open folder…')
    expect(screen.queryByTestId('upstream-project-view')).toBeNull()
  })

  it('opens a workspace from a folder on button click when no workspace is selected', () => {
    render(<ProjectToolWindow />)
    fireEvent.click(screen.getByTestId('project-open-folder-button'))

    expect(workspaceActions.addWorkspaceFromFolder).toHaveBeenCalledTimes(1)
    expect(workspaceActions.addFolderToWorkspace).not.toHaveBeenCalled()
  })

  it('adds a project folder to the selected workspace when it has none', () => {
    act(() => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'ws-1', name: 'Dev', folders: [] }] as never,
        selection: 'ws-1::f',
      })
    })
    render(<ProjectToolWindow />)

    expect(screen.getByText('No project folders in this workspace')).toBeTruthy()
    fireEvent.click(screen.getByTestId('project-open-folder-button'))

    expect(workspaceActions.addFolderToWorkspace).toHaveBeenCalledWith('ws-1')
    expect(workspaceActions.addWorkspaceFromFolder).not.toHaveBeenCalled()
  })

  it('renders upstream ProjectView when root is set', () => {
    act(() => {
      useProjectTree.setState({ root: '/path/to/my-project' })
    })

    render(<ProjectToolWindow />)

    expect(screen.getByTestId('project-tool-window')).toBeTruthy()
    expect(screen.getByTestId('upstream-project-view')).toBeTruthy()
    expect(screen.queryByTestId('project-empty-state')).toBeNull()
  })

  it('registers project tool window with order 0 and requiresProject: false', () => {
    const dispose = registerShellToolWindows()

    try {
      const toolWindow = useContributions.getState().toolWindows.get('project')
      expect(toolWindow).toBeDefined()
      expect(toolWindow?.title).toBe('Project')
      expect(toolWindow?.anchor).toBe('left')
      expect(toolWindow?.order).toBe(0)
      expect(toolWindow?.requiresProject).toBe(false)
    } finally {
      dispose()
    }
  })

  it('names the workspace above its projects and counts the ones switched on', () => {
    act(() => {
      useProjectTree.setState({ root: '/w' } as never)
      useWorkspaceStore.setState({
        workspaces: [{ id: 'w1', name: 'dev', order: 0, pins: [], folders: [{ id: 'a', name: 'a', path: '/a' }, { id: 'b', name: 'b', path: '/b', disabled: true }] }],
        selection: 'w1',
        scope: 'workspace',
      } as never)
    })
    render(<ProjectToolWindow />)
    expect(screen.getByTestId('workspace-header').textContent).toContain('dev (Workspace)')
    expect(screen.getByTestId('workspace-header-count').textContent).toBe('1/2 projects')
    fireEvent.click(screen.getByRole('button', { name: 'Save as VS Code Workspace…' }))
    expect(workspaceActions.exportWorkspaceFile).toHaveBeenCalledTimes(1)
  })
})
