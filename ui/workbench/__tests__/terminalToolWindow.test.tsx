/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  show: vi.fn(),
  showSessionTab: vi.fn(),
  contextMenu: vi.fn(),
  registered: [] as Array<{ id: string; anchor?: string; requiresProject?: boolean }>,
  actions: [] as Array<{ id: string; run: () => void }>,
}))
vi.mock('../../ide/workbench/contributions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toolWindowService: () => ({ show: mocks.show }),
  registerToolWindow: vi.fn((item: { id: string }) => {
    mocks.registered.push(item)
    return () => {}
  }),
}))
vi.mock('../../ide/platform/actions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  registerAction: vi.fn((action: { id: string; run: () => void }) => {
    mocks.actions.push(action)
    return () => {}
  }),
}))
vi.mock('../../ide/ui/Menu', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showContextMenu: mocks.contextMenu,
}))
vi.mock('../sessions/sessionTabActions', () => ({ showSessionTab: mocks.showSessionTab }))

import { useTabs } from '../../ide/editor/core/controller'
import { useProject } from '../../ide/platform/project'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { EDITOR_TAB_MIME } from '../../ide/workbench/contributions'
import { resetSessionBridge, useSessionBridge, type SessionBridgeApi, type SessionInfo } from '../sessions/sessionBridge'
import { SESSION_DRAG } from '../sessions/sessionDrag'
import { sessionInput } from '../sessions/sessionInput'
import { resetSurfaces, surfaceHost } from '../sessions/surfaceRegistry'
import { registerTerminalToolWindow } from '../terminalDock/registerTerminalToolWindow'
import { moveSessionToTerminalWindow, projectMenuItems, requestDockedTerminal, resumeWhereItRan, shellMenuItems, TERMINAL_WINDOW } from '../terminalDock/terminalDockActions'
import { dockSession, isDocked, resetTerminalDock, startTerminalDockSync, useTerminalDock } from '../terminalDock/terminalDockStore'
import { draggedSession } from '../terminalDock/draggedSession'
import { TerminalDockTabs, TerminalToolWindow } from '../terminalDock/TerminalToolWindow'

const api: SessionBridgeApi = {
  killSession: vi.fn(),
  newSessionLike: vi.fn(),
  reconnect: vi.fn(),
  skipConfirm: vi.fn(() => false),
  setSkipConfirm: vi.fn(),
}
const info = (id: string, name = id): SessionInfo => ({
  id,
  connId: id,
  name,
  connType: 'LOCAL',
  workspaceId: null,
  status: 'connected',
  busy: false,
  cwd: 'D:\\work\\repo',
  hasCommand: false,
})
const publish = (...sessions: SessionInfo[]) => act(() => useSessionBridge.setState({ sessions, api, restoreSettled: true }))
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  resetTerminalDock()
  mocks.registered = []
  mocks.actions = []
})
afterEach(() => {
  cleanup()
  resetSurfaces()
  resetSessionBridge()
  resetTerminalDock()
  useProject.setState({ project: null } as never)
  vi.clearAllMocks()
})

describe('Terminal tool window', () => {
  // Regression: a terminal started from elsewhere into the closed bottom window left no trace of
  // where it went; the stripe icon now counts the sessions docked there.
  it('badges its stripe icon with the number of docked sessions', () => {
    const dispose = registerTerminalToolWindow()
    const window_ = mocks.registered.find((item) => (item as { id?: string }).id === TERMINAL_WINDOW) as { useBadge?: () => unknown }
    const { result } = renderHook(() => window_.useBadge?.())
    expect(result.current).toBeNull()
    act(() => {
      dockSession('a')
      dockSession('b')
    })
    expect(result.current).toBe(2)
    dispose()
  })

  it('offers a new terminal when nothing is docked', () => {
    const started = vi.fn()
    window.addEventListener('omniterm:new-session', started)
    useProject.setState({ project: { root: 'D:\\work\\repo' } } as never)
    render(<TerminalToolWindow />)
    fireEvent.click(screen.getByRole('button', { name: 'New Terminal' }))
    expect((started.mock.calls[0]![0] as CustomEvent).detail).toEqual({ cwd: 'D:\\work\\repo' })
    expect(useTerminalDock.getState().pending).toBe(1)
    expect(mocks.show).toHaveBeenCalledWith(TERMINAL_WINDOW)
    window.removeEventListener('omniterm:new-session', started)
  })

  it('starts a terminal without a folder when no project is open', () => {
    const started = vi.fn()
    window.addEventListener('omniterm:new-session', started)
    requestDockedTerminal()
    expect((started.mock.calls[0]![0] as CustomEvent).detail).toBeNull()
    window.removeEventListener('omniterm:new-session', started)
  })

  it('starts the shell chosen from "New Terminal ⌄", like IDEA', () => {
    const started = vi.fn()
    window.addEventListener('omniterm:new-session', started)
    useProject.setState({ project: { root: 'D:\\work\\repo' } } as never)
    const items = shellMenuItems(
      [
        { id: 'powershell', label: 'Windows PowerShell' },
        { id: 'cmd', label: 'Command Prompt' },
        { id: 'wsl', label: 'Windows Subsystem for Linux (WSL)' },
      ],
    )
    expect(items.map((item) => item.label)).toEqual(['Windows PowerShell', 'Command Prompt', 'Windows Subsystem for Linux (WSL)'])
    items[1]!.run()
    expect((started.mock.calls[0]![0] as CustomEvent).detail).toEqual({ cwd: 'D:\\work\\repo', shell: 'cmd' })
    // A click event handed over as the argument is not a shell.
    requestDockedTerminal(new MouseEvent('click'))
    expect((started.mock.calls[1]![0] as CustomEvent).detail).toEqual({ cwd: 'D:\\work\\repo' })
    window.removeEventListener('omniterm:new-session', started)
  })

  // Regression: "New Terminal ⌄" only listed shells, so a workspace's other projects could not be
  // chosen; every terminal started in the default project.
  it('offers each project of a workspace, its shells starting in that project', () => {
    const started = vi.fn()
    window.addEventListener('omniterm:new-session', started)
    const options = [{ id: 'pwsh', label: 'PowerShell' }]
    useProject.setState({ project: { root: 'D:/work/repo' } } as never)
    expect(projectMenuItems(options)).toEqual([])

    useProject.setState({ project: { root: 'D:/data/ws', workspace: { projects: ['D:/work/api', 'D:/work/web/'] } } } as never)
    const items = projectMenuItems(options) as { label?: string; checked?: boolean; submenu?: { run: () => void }[] }[]
    const rows = items.filter((item) => item.submenu)
    expect(rows.map((row) => row.label)).toEqual(['api', 'web'])
    expect(rows.map((row) => row.checked)).toEqual([true, false])
    rows[1]!.submenu![0]!.run()
    expect((started.mock.calls[0]![0] as CustomEvent).detail).toEqual({ cwd: 'D:/work/web/', shell: 'pwsh' })
    window.removeEventListener('omniterm:new-session', started)
  })

  it('lists the enabled projects of the selected workspace, even before the IDE project has opened them', () => {
    useProject.setState({ project: null } as never)
    useWorkspaceStore.setState({
      workspaces: [{ id: 'w1', name: 'dev', order: 0, pins: [], folders: [
        { id: 'a', name: 'a', path: 'D:/work/a' }, { id: 'b', name: 'b', path: 'D:/work/b', disabled: true }, { id: 'c', name: 'c', path: 'D:/work/c' },
      ] }],
      selection: 'w1',
    } as never)
    const rows = (projectMenuItems([{ id: 'pwsh', label: 'PowerShell' }]) as { label?: string; submenu?: unknown }[]).filter((item) => item.submenu)
    expect(rows.map((row) => row.label)).toEqual(['a', 'c'])
    useWorkspaceStore.setState({ workspaces: [], selection: null } as never)
  })

  it('lends the shown docked session its terminal surface', () => {
    publish(info('a'), info('b'))
    act(() => {
      dockSession('a')
      dockSession('b')
    })
    const { container } = render(<TerminalToolWindow />)
    const box = container.querySelector('[data-terminal-dock-surface]')
    expect(box?.getAttribute('data-terminal-dock-surface')).toBe('b')
    expect(box?.contains(surfaceHost('b'))).toBe(true)
  })

  it('moves a session from its editor tab into the window', () => {
    moveSessionToTerminalWindow('a')
    expect(isDocked('a')).toBe(true)
    expect(mocks.show).toHaveBeenCalledWith(TERMINAL_WINDOW)
  })
})

describe('docking by drag and resume', () => {
  it('resumes a session that ran in the dock back into the dock', () => {
    publish(info('old'))
    act(() => dockSession('old'))
    const stop = startTerminalDockSync()
    publish()
    resumeWhereItRan('old')
    expect(useTerminalDock.getState().pending).toBe(1)
    expect(mocks.show).toHaveBeenCalledWith(TERMINAL_WINDOW)
    mocks.show.mockClear()
    resumeWhereItRan('never-docked')
    resumeWhereItRan(undefined)
    expect(useTerminalDock.getState().pending).toBe(1)
    expect(mocks.show).not.toHaveBeenCalled()
    stop()
  })

  // The other way into the dock: drag a terminal's editor tab (or its Sessions row) onto the window.
  it('reads the session a dragged editor tab or Sessions row carries', () => {
    publish(info('a'))
    act(() => useTabs.setState({ panes: { p1: { id: 'p1', tabs: [{ id: 'tab1', input: sessionInput('a') }, { id: 'tab2', input: { kind: 'file', key: 'f' } }] } } } as never))
    expect(draggedSession(EDITOR_TAB_MIME, JSON.stringify({ paneId: 'p1', tabId: 'tab1' }))).toBe('a')
    expect(draggedSession(EDITOR_TAB_MIME, JSON.stringify({ paneId: 'p1', tabId: 'tab2' }))).toBeNull()
    expect(draggedSession(EDITOR_TAB_MIME, 'not json')).toBeNull()
    expect(draggedSession(SESSION_DRAG, 'a')).toBe('a')
    expect(draggedSession(SESSION_DRAG, 'gone')).toBeNull()
    expect(draggedSession('text/plain', 'a')).toBeNull()
  })
})

describe('Terminal tool window tabs', () => {
  it('lists docked live sessions, selects one and starts a new one from "+"', () => {
    publish(info('a', 'pwsh'), info('b', 'bash'))
    act(() => {
      dockSession('a')
      dockSession('b')
      dockSession('gone')
    })
    render(<TerminalDockTabs />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['pwsh \u2014 repo', 'bash \u2014 repo'])
    fireEvent.click(tabs[0]!)
    expect(useTerminalDock.getState().active).toBe('a')
    fireEvent.click(screen.getByRole('button', { name: 'New Terminal' }))
    expect(useTerminalDock.getState().pending).toBe(1)
  })

  // Regression: picking a docked terminal tab left focus on the tab, so typing did not reach the
  // agent running in it until the terminal itself was clicked.
  it('hands the keyboard to the terminal of the picked tab', () => {
    const asked: unknown[] = []
    const onFocusTerminal = (event: Event) => asked.push((event as CustomEvent).detail)
    window.addEventListener('omniterm:focus-terminal', onFocusTerminal)
    publish(info('a', 'pwsh'), info('b', 'bash'))
    act(() => {
      dockSession('a')
      dockSession('b')
    })
    render(<TerminalDockTabs />)
    const tabs = screen.getAllByRole('tab')
    fireEvent.click(tabs[1]!)
    fireEvent.click(tabs[1]!)
    expect(asked).toEqual([{ id: 'b' }, { id: 'b' }])
    window.removeEventListener('omniterm:focus-terminal', onFocusTerminal)
  })

  it('closes a docked tab: the session leaves the window and ends', async () => {
    publish(info('a', 'pwsh'))
    act(() => dockSession('a'))
    const { container } = render(<TerminalDockTabs />)
    const close = container.querySelector('[data-tab-close] button') as HTMLButtonElement
    fireEvent.click(close)
    await flush()
    expect(isDocked('a')).toBe(false)
    expect(api.killSession).toHaveBeenCalledWith('a')
  })

  it('moves a docked session back to the editor from its context menu', async () => {
    publish(info('a', 'pwsh'))
    act(() => dockSession('a'))
    render(<TerminalDockTabs />)
    fireEvent.contextMenu(screen.getByRole('tab'))
    const items = mocks.contextMenu.mock.calls[0]![1] as Array<{ label?: string; run?: () => void }>
    expect(items.flatMap((item) => (item.label ? [item.label] : []))).toEqual(['Move to Editor', 'Close Tab'])
    act(() => items[0]!.run!())
    expect(isDocked('a')).toBe(false)
    expect(mocks.showSessionTab).toHaveBeenCalledWith('a')
    act(() => dockSession('a'))
    act(() => items[2]!.run!())
    await flush()
    expect(api.killSession).toHaveBeenCalledWith('a')
  })
})

describe('registerTerminalToolWindow', () => {
  it('registers the bottom window and its New Terminal action, and keeps the dock in sync', () => {
    const dispose = registerTerminalToolWindow()
    expect(mocks.registered).toEqual([expect.objectContaining({ id: TERMINAL_WINDOW, anchor: 'bottom', requiresProject: false })])
    expect(mocks.actions.map((action) => action.id)).toEqual(['omniterm.terminal.new'])
    act(() => dockSession('a'))
    publish(info('b'))
    expect(isDocked('a')).toBe(false)
    dispose()
  })
})
