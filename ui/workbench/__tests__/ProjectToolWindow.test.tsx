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
  setFolderDisabled: vi.fn().mockResolvedValue(undefined),
  workspaceFolderAt: (workspace: { folders: Array<{ path: string }> } | null, path: string) =>
    workspace?.folders.find((folder) => folder.path === path) ?? null,
  activeFolders: (workspace?: { folders: Array<{ disabled?: boolean }> } | null) => (workspace?.folders ?? []).filter((folder) => !folder.disabled),
}))
vi.mock('../titlebar/workspaceActions', () => workspaceActions)

import { RootCheckbox } from '../../ide/features/project-tree/RootCheckbox'
import { useRootChecked } from '../../ide/features/project-tree/rootToggle'
import { useProjectTree } from '../../ide/features/project-tree/store'
import { useContributions } from '../../ide/workbench/contributions'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { renderHook } from '@testing-library/react'
import { useWorkspaceTitleMenu } from '../useWorkspaceTitleMenu'
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
    expect(screen.getByTestId('workspace-header').textContent).not.toContain('(Workspace)')
    expect(screen.getByTestId('workspace-header-count').textContent).toBe('1/2 projects')
    fireEvent.click(screen.getByRole('button', { name: 'Save as VS Code Workspace…' }))
    expect(workspaceActions.exportWorkspaceFile).toHaveBeenCalledTimes(1)
  })

  const multi = (disabled = false) => {
    act(() => {
      useProjectTree.setState({ root: '/w' } as never)
      useWorkspaceStore.setState({
        workspaces: [{ id: 'w1', name: 'dev', order: 0, pins: [], folders: [{ id: 'a', name: 'a', path: '/a' }, { id: 'b', name: 'b', path: '/b', disabled }] }],
        selection: 'w1',
        scope: 'workspace',
      } as never)
    })
  }

  it('titles a multi-project window with the workspace name alone', () => {
    multi()
    const { result } = renderHook(() => useWorkspaceTitleMenu())
    expect(result.current.label).toBe('dev')
    expect(result.current).not.toHaveProperty('detail')
  })

  it('keeps the Project title for a single project', () => {
    act(() => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'w1', name: 'dev', order: 0, pins: [], folders: [{ id: 'a', name: 'a', path: '/a' }] }],
        selection: 'w1',
      } as never)
    })
    const { result } = renderHook(() => useWorkspaceTitleMenu())
    expect(result.current.label).toBe('Project')
  })

  it('checks every active project and switches one off when unchecked', () => {
    multi()
    render(<ProjectToolWindow />)
    const { result } = renderHook(() => useRootChecked('/a'))
    expect(result.current?.checked).toBe(true)
    act(() => result.current?.toggle())
    expect(workspaceActions.setFolderDisabled).toHaveBeenCalledWith('w1', expect.objectContaining({ id: 'a' }), true)
  })

  it('never switches off the last active project', () => {
    multi(true)
    render(<ProjectToolWindow />)
    const { result } = renderHook(() => useRootChecked('/a'))
    act(() => result.current?.toggle())
    expect(workspaceActions.setFolderDisabled).not.toHaveBeenCalled()
  })

  it('lists switched-off projects unchecked and activates one when checked', () => {
    multi(true)
    render(<ProjectToolWindow />)
    fireEvent.click(screen.getByLabelText('b is switched off'))
    expect(workspaceActions.setFolderDisabled).toHaveBeenCalledWith('w1', expect.objectContaining({ id: 'b' }), false)
  })

  it('draws the project toggles as radio buttons that still behave as checkboxes', () => {
    multi(true)
    render(<ProjectToolWindow />)
    const off = screen.getByLabelText('b is switched off')
    expect(off.getAttribute('type')).toBe('checkbox')
    expect(off.dataset.look).toBe('radio')
    expect(off.className).toContain('rounded-full')
    act(() => useWorkspaceStore.setState({ selection: 'w1' } as never))
    const root = render(<RootCheckbox path="/a" name="a" />)
    const box = root.getByTestId('project-root-checkbox')
    expect(box.getAttribute('type')).toBe('checkbox')
    expect(box.dataset.look).toBe('radio')
  })
})
