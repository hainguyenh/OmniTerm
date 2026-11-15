/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

import { useProject } from '../../ide/platform/project'
import { resetSessionBridge, useSessionBridge, type SessionBridgeApi, type SessionInfo } from '../sessions/sessionBridge'
import { resetSurfaces, surfaceHost } from '../sessions/surfaceRegistry'
import { registerTerminalToolWindow } from '../terminalDock/registerTerminalToolWindow'
import { moveSessionToTerminalWindow, requestDockedTerminal, shellMenuItems, TERMINAL_WINDOW } from '../terminalDock/terminalDockActions'
import { dockSession, isDocked, resetTerminalDock, useTerminalDock } from '../terminalDock/terminalDockStore'
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
