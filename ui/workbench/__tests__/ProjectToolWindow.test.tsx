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
}))
vi.mock('../titlebar/workspaceActions', () => workspaceActions)

import { useProjectTree } from '../../ide/features/project-tree/store'
import { useContributions } from '../../ide/workbench/contributions'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import {
  setConnectionsHost,
  setConnectionsVisibility,
  useWorkspaceConnectionsStore,
} from '../connections/workspaceConnectionsRoot'
import { ProjectToolWindow } from '../ProjectToolWindow'
import { registerShellToolWindows } from '../registerShellToolWindows'
import { useTreeViewport } from './treeViewport'

describe('ProjectToolWindow', () => {
  useTreeViewport()

  beforeEach(() => {
    act(() => {
      useProjectTree.setState({ root: null })
      setConnectionsVisibility(true)
      setConnectionsHost(true, null)
      useWorkspaceConnectionsStore.getState().setConnections([])
      useWorkspaceStore.setState({ workspaces: [], selection: null })
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => {
      useProjectTree.setState({ root: null })
      setConnectionsHost(false, null)
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

  it('renders standalone connections grouped by kind and opens one on double click', () => {
    const connect = vi.fn()
    const connection = { id: 'ssh-node', name: 'My SSH Box', type: 'SSH' as const, host: '10.0.0.5', port: '22', user: 'ops' }
    act(() => {
      setConnectionsHost(true, { connect, add: vi.fn() })
      useWorkspaceConnectionsStore.getState().setConnections([connection])
    })

    render(<ProjectToolWindow />)

    expect(screen.getByTestId('project-standalone-connections')).toBeTruthy()
    expect(screen.getByText('SSH')).toBeTruthy()
    expect(screen.getByText('My SSH Box')).toBeTruthy()

    fireEvent.doubleClick(screen.getByTestId('connection-row-ssh-node'))
    expect(connect).toHaveBeenCalledWith(connection)
  })

  it('hides standalone connections while no connection provider is active', () => {
    act(() => {
      useWorkspaceConnectionsStore.getState().setConnections([
        { id: 'ssh-node', name: 'My SSH Box', type: 'SSH', host: '10.0.0.5', port: '22', user: 'ops' },
      ])
      setConnectionsHost(false, null)
    })

    render(<ProjectToolWindow />)

    expect(screen.queryByTestId('project-standalone-connections')).toBeNull()
  })

  it('hides standalone connections when toggled off', () => {
    act(() => {
      setConnectionsVisibility(false)
    })

    render(<ProjectToolWindow />)

    expect(screen.queryByTestId('project-standalone-connections')).toBeNull()
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
})
