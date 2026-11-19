/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
import { isDefaultRoot, useManagedRoot, useRootChecked } from '../../ide/features/project-tree/rootToggle'
import { useProjectFilterStore } from '../projectFilterStore'
import { useProjectTree } from '../../ide/features/project-tree/store'
import { useContributions } from '../../ide/workbench/contributions'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { renderHook } from '@testing-library/react'
import { useWorkspaceTitleMenu } from '../useWorkspaceTitleMenu'
import { OmniTermProjectHeaderActions, ProjectToolWindow } from '../ProjectToolWindow'
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

  const itemLabels = (items: ReturnType<typeof useWorkspaceTitleMenu>['items']) =>
    items.flatMap((item) => (item.kind === undefined || item.kind === 'item' ? [item.label] : []))

  it('offers no Project Files mode and names the Project mode Workspace with several projects', () => {
    multi()
    const { result } = renderHook(() => useWorkspaceTitleMenu())
    const labels = itemLabels(result.current.items)
    expect(labels).not.toContain('Project Files')
    expect(labels).toContain('Workspace')
    expect(labels).not.toContain('Project')
  })

  it('moves a remembered Project Files mode back to Project', () => {
    multi()
    act(() => useProjectTree.setState({ mode: 'projectFiles' }))
    render(<ProjectToolWindow />)
    expect(useProjectTree.getState().mode).toBe('project')
  })

  it('puts Expand All next to Collapse All in the header', () => {
    render(<OmniTermProjectHeaderActions />)
    const buttons = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.title)
    const expand = buttons.findIndex((label) => label?.startsWith('Expand All'))
    expect(expand).toBeGreaterThanOrEqual(0)
    expect(buttons[expand + 1]).toMatch(/^Collapse All/)
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

  it('keeps a switched-off project in the tree unchecked and activates it when checked', () => {
    multi(true)
    render(<ProjectToolWindow />)
    // No separate list of switched-off projects any more: the tree row carries the state.
    expect(screen.queryByTestId('workspace-header-off')).toBeNull()
    const { result } = renderHook(() => useRootChecked('/b'))
    expect(result.current?.checked).toBe(false)
    act(() => result.current?.toggle())
    expect(workspaceActions.setFolderDisabled).toHaveBeenCalledWith('w1', expect.objectContaining({ id: 'b' }), false)
  })

  it('draws the project toggle as a square checkbox with a check mark only while on', () => {
    multi(true)
    render(<ProjectToolWindow />)
    const on = within(render(<RootCheckbox path="/a" name="a" />).container).getByTestId('project-root-checkbox')
    expect(on.getAttribute('type')).toBe('checkbox')
    expect(on.dataset.look).toBe('checkbox')
    expect((on as HTMLInputElement).checked).toBe(true)
    expect(on.nextElementSibling?.childElementCount).toBe(1)
    const off = within(render(<RootCheckbox path="/b" name="b" />).container).getByTestId('project-root-checkbox')
    expect((off as HTMLInputElement).checked).toBe(false)
    expect(off.nextElementSibling?.childElementCount).toBe(0)
  })

  it('marks the first active project as default until another is chosen', () => {
    multi()
    useProjectFilterStore.setState({ defaults: {} })
    render(<ProjectToolWindow />)
    expect(renderHook(() => useManagedRoot('/a')).result.current?.isDefault).toBe(true)
    const b = renderHook(() => useManagedRoot('/b'))
    expect(b.result.current?.isDefault).toBe(false)
    act(() => b.result.current?.setDefault())
    expect(useProjectFilterStore.getState().defaults.w1).toBe('/b')
    expect(isDefaultRoot('/b')).toBe(true)
    expect(isDefaultRoot('/a')).toBe(false)
  })

  it('opens a terminal in the project folder from the row action', () => {
    multi()
    render(<ProjectToolWindow />)
    const listener = vi.fn()
    window.addEventListener('omniterm:new-session', listener)
    try {
      const { result } = renderHook(() => useManagedRoot('/b'))
      expect(result.current).toBeDefined()
      act(() => result.current?.openTerminal())
      expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ cwd: '/b' })
    } finally {
      window.removeEventListener('omniterm:new-session', listener)
    }
  })
})
