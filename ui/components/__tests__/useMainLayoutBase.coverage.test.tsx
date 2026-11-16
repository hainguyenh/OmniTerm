/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../domain'
import { TOKYO_NIGHT } from '../../themes'
import { mockOmnitermAPI } from '../../testUtils'
import type { MainLayoutProps } from '../mainLayoutShared'
import { useMainLayoutBase } from '../useMainLayoutBase'

const showAlert = vi.fn(async () => {})
const showConfirm = vi.fn(async () => true)
const openNewSession = vi.fn(async (_shell: string, connect: (conn: unknown) => void) => connect({ id: 'new', type: 'LOCAL' }))
const loadShellOptions = vi.fn(async () => [{ id: 'powershell', label: 'PowerShell' }])
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ dialogState: null, showAlert, showConfirm }) }))
const openNewSessionCwd = vi.fn()
vi.mock('../../newSession', () => ({
  openNewSession: (shell: any, connect: any, _workspaceId?: unknown, _folderId?: unknown, cwd?: unknown) => {
    openNewSessionCwd(cwd ?? null)
    return openNewSession(shell, connect)
  },
}))
vi.mock('../../shellOptions', () => ({
  loadShellOptions: () => loadShellOptions(),
  pickShell: (options: Array<{ id: string }>, requested?: string) => options.some(o => o.id === requested) ? requested : options[0]?.id ?? 'powershell',
}))

const settings: AppSettings = {
  themeId: TOKYO_NIGHT.id, fontSize: 14, smartColors: true, checkUpdatesOnStartup: true, darkMode: true,
}
const latest: UpdateState = {
  current: '1.0.0', latest: '2.0.0', latestTag: 'v2.0.0', latestName: 'Two', notes: '', htmlUrl: '', publishedAt: null,
  updateAvailable: true, skippedVersion: null, lastCheckAt: null, error: null, checking: false, isPortable: true,
  portableAssetUrl: 'portable', installerAssetUrl: 'installer', downloadProgress: null, downloadStatus: null, hasNewerVersion: true,
}
const local: Connection = { id: 'local', name: 'Local', type: 'LOCAL', host: '', port: '', user: '', shell: 'powershell' }
const ssh: Connection = { id: 'ssh', name: 'SSH', type: 'SSH', host: 'host', port: '22', user: 'me' }

function props(overrides: Partial<MainLayoutProps> = {}): MainLayoutProps {
  return {
    appSettings: settings, setAppSettings: vi.fn(), currentTheme: TOKYO_NIGHT, layoutMode: 1, setLayoutMode: vi.fn(),
    themes: [TOKYO_NIGHT],
    onSettingsReload: vi.fn(), ...overrides,
  }
}

let emitDetached: ((id: string, detached: boolean) => void) | undefined
let emitReattached: ((id: string) => void) | undefined
beforeEach(() => {
  localStorage.clear()
  showAlert.mockClear(); showConfirm.mockClear();
  openNewSession.mockClear(); loadShellOptions.mockClear()
  emitDetached = undefined; emitReattached = undefined
  mockOmnitermAPI({
    customArt: { get: vi.fn(async (slot: string) => `blob:${slot}`) },
    workspace: { list: vi.fn(async () => [{ id: 'w' }]), loadConnections: vi.fn(async () => [ssh]) },
    connect: {
      onRDPDetachState: vi.fn((fn: (id: string, detached: boolean) => void) => { emitDetached = fn; return vi.fn() }),
      rdpSetDetached: vi.fn(),
    },
    terminalWindow: {
      detach: vi.fn(async () => true), reattach: vi.fn(async () => {}), focus: vi.fn(async () => {}),
      onReattached: vi.fn((fn: (id: string) => void) => { emitReattached = fn; return vi.fn() }),
    },
    updates: {
      check: vi.fn(async () => latest), skip: vi.fn(async () => latest), showSaveDialog: vi.fn(async () => '/tmp/app.exe'),
      downloadPortable: vi.fn(async () => {}), downloadInstaller: vi.fn(async () => {}),
    },
    settings: { save: vi.fn(async () => {}), onChanged: vi.fn(() => vi.fn()) },
  })
})
afterEach(() => vi.restoreAllMocks())

describe('useMainLayoutBase complete behavior', () => {

  // Always Awake is a built-in feature switched in the Plugins dialog: while it is off the app must
  // not offer it nor subscribe to the native poller, and it follows the switch without a reload.
  it('offers Always Awake only while the feature is on, and subscribes to it only then', async () => {
    const getState = vi.fn(async () => ({ enabled: true, mode: 'always', expiresAtMs: 1, activeSessionCount: 0, keepingAwake: true, supported: true, error: null }))
    const unsubscribe = vi.fn()
    const onState = vi.fn(() => unsubscribe)
    const changed: Array<() => void> = []
    let on = false
    mockOmnitermAPI({
      plugin: { onChanged: vi.fn((fn: () => void) => { changed.push(fn); return vi.fn() }) },
      alwaysAwake: { info: vi.fn(async () => on), getState, onState },
    })
    const { result, unmount } = renderHook(() => useMainLayoutBase(props()))
    await waitFor(() => expect(window.omnitermAPI.alwaysAwake.info).toHaveBeenCalled())
    expect(result.current.alwaysAwakeAvailable).toBe(false)
    expect(getState).not.toHaveBeenCalled()
    expect(onState).not.toHaveBeenCalled()

    on = true
    act(() => changed.forEach((fn) => fn()))
    await waitFor(() => expect(result.current.alwaysAwakeAvailable).toBe(true))
    await waitFor(() => expect(result.current.alwaysAwake.keepingAwake).toBe(true))
    expect(onState).toHaveBeenCalledTimes(1)

    on = false
    act(() => changed.forEach((fn) => fn()))
    await waitFor(() => expect(result.current.alwaysAwakeAvailable).toBe(false))
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('loads shell options, workspace connections, and all custom art modes', async () => {
    const { result } = renderHook(() => useMainLayoutBase(props()))
    await waitFor(() => expect(result.current.savedConnections).toEqual([{ ...ssh, workspaceId: 'w' }]))
    expect(result.current.shellOptions).toEqual([{ id: 'powershell', label: 'PowerShell' }])
    expect(result.current.idleArtUrl).toBe('blob:idle-dark')
    expect(result.current.loadingArtUrl).toBe('blob:loading-dark')
  })

  it('handles art and workspace load errors without crashing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockOmnitermAPI({
      customArt: { get: vi.fn(async () => { throw new Error('missing') }) },
      workspace: { list: vi.fn(async () => { throw new Error('disk') }) },
    })
    const { result } = renderHook(() => useMainLayoutBase(props({ appSettings: { ...settings, darkMode: false } })))
    await waitFor(() => expect(result.current.idleArtUrlLight).toBeNull())
    expect(result.current.savedConnections).toEqual([])
    expect(error).toHaveBeenCalled()
  })

  it('updates session state idempotently and tracks connected timestamps', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(777)
    const { result } = renderHook(() => useMainLayoutBase(props()))
    act(() => {
      result.current.setStatus('s', 'connected')
      result.current.setLatency('s', 15)
      result.current.setMetric('s', { latency: 15, cpu: 1, memUsed: 2, memTotal: 3, diskUsedPct: 4, ts: 5 })
      result.current.setBusy('s', true)
    })
    await waitFor(() => expect(result.current.connectedAt.s).toBe(777))
    const statuses = result.current.statuses
    const latencies = result.current.latencies
    const activity = result.current.activity
    act(() => {
      result.current.setStatus('s', 'connected')
      result.current.setLatency('s', 15)
      result.current.setBusy('s', true)
    })
    expect(result.current.statuses).toBe(statuses)
    expect(result.current.latencies).toBe(latencies)
    expect(result.current.activity).toBe(activity)
    act(() => result.current.setStatus('s', 'closed'))
    await waitFor(() => expect(result.current.connectedAt.s).toBeUndefined())
  })

  it('toggles RDP detach state, receives backend state, pops out terminals, reattaches, and focuses', async () => {
    const reload = vi.fn()
    const { result } = renderHook(() => useMainLayoutBase(props({ onSettingsReload: reload })))
    act(() => {
      result.current.setEphemeralConns([local])
      result.current.setActiveTabs([{ id: 'session', connId: local.id, name: 'Local' }])
      result.current.toggleDetach('rdp')
    })
    expect(window.omnitermAPI.connect.rdpSetDetached).toHaveBeenCalledWith('rdp', true)
    act(() => emitDetached?.('rdp', false))
    expect(result.current.detached.rdp).toBe(false)

    act(() => result.current.popOutTerminal('session'))
    await waitFor(() => expect(result.current.poppedOut.session).toBe(true))
    expect(result.current.resumeMode.session).toBe(true)
    // Slot-move reattach: the session lands in the requested pane, swapping occupants, and focus
    // follows it. Without a target the call passes straight through.
    act(() => {
      result.current.setPanes(['session', 'other', null, null])
    })
    act(() => result.current.reattachTerminal('session', 1))
    expect(window.omnitermAPI.terminalWindow.reattach).toHaveBeenCalledWith('session')
    expect(result.current.panes[1]).toBe('session')
    expect(result.current.panes[0]).toBe('other')
    expect(result.current.focusedPane).toBe(1)
    act(() => emitReattached?.('session'))
    expect(result.current.poppedOut.session).toBe(false)
    expect(reload).toHaveBeenCalledWith('session')
    // The receiving pane pulses so the eye lands on the fold-back target.
    expect(result.current.pulsePaneId).toBe('session')

    const dispatch = vi.spyOn(window, 'dispatchEvent')
    act(() => result.current.focusTerminal('session'))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'omniterm:focus-terminal' }))
  })

  it('reattach without a target slot leaves the pane layout untouched', () => {
    const { result } = renderHook(() => useMainLayoutBase(props()))
    act(() => { result.current.setPanes(['a', 'b', null, null]) })
    act(() => result.current.reattachTerminal('b'))
    expect(result.current.panes).toEqual(['a', 'b', null, null])
    expect(window.omnitermAPI.terminalWindow.reattach).toHaveBeenCalledWith('b')
  })

  it('rejects invalid pop-out targets and a backend detach refusal', async () => {
    const { result } = renderHook(() => useMainLayoutBase(props()))
    act(() => result.current.popOutTerminal('missing'))
    expect(window.omnitermAPI.terminalWindow.detach).not.toHaveBeenCalled()
    act(() => { result.current.setEphemeralConns([{ ...local, type: 'RDP' }]); result.current.setActiveTabs([{ id: 'rdp', connId: local.id, name: 'RDP' }]) })
    act(() => result.current.popOutTerminal('rdp'))
    expect(window.omnitermAPI.terminalWindow.detach).not.toHaveBeenCalled()
    vi.mocked(window.omnitermAPI.terminalWindow.detach).mockResolvedValueOnce(false)
    act(() => { result.current.setEphemeralConns([local]); result.current.setActiveTabs([{ id: 'local', connId: local.id, name: 'Local' }]) })
    act(() => result.current.popOutTerminal('local'))
    await waitFor(() => expect(window.omnitermAPI.terminalWindow.detach).toHaveBeenCalled())
    expect(result.current.poppedOut.local).toBeUndefined()
  })


  it('restores UI state, opens sessions from events, toggles sidebar and command palette, then removes listeners', async () => {
    localStorage.setItem('cc.sidebarWidth', '999')
    localStorage.setItem('cc.activeView', 'connections')
    const { result, unmount } = renderHook(() => useMainLayoutBase(props()))
    await waitFor(() => expect(result.current.sidebarWidth).toBe(520))
    expect(result.current.activeView).toBe('workspace')
    const connect = vi.fn()
    result.current.handleConnectRef.current = connect
    act(() => window.dispatchEvent(new CustomEvent('omniterm:new-session', { detail: { shell: 'powershell' } })))
    await waitFor(() => expect(openNewSession).toHaveBeenCalledWith('powershell', expect.any(Function)))
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' }))

    openNewSession.mockClear()
    act(() => window.dispatchEvent(new CustomEvent('omniterm:new-session', { detail: { cwd: 'C:/repo.worktrees/topic' } })))
    await waitFor(() => expect(openNewSessionCwd).toHaveBeenLastCalledWith('C:/repo.worktrees/topic'))

    openNewSession.mockClear()
    act(() => result.current.requestNewSession('powershell'))
    await waitFor(() => expect(openNewSession).toHaveBeenCalledWith('powershell', expect.any(Function)))

    act(() => window.dispatchEvent(new Event('omniterm:toggle-sidebar')))
    expect(result.current.activeView).toBeNull()
    act(() => window.dispatchEvent(new Event('omniterm:toggle-sidebar')))
    expect(result.current.activeView).toBe('workspace')
    act(() => window.dispatchEvent(new Event('omniterm:command-palette')))
    expect(result.current.commandPaletteOpen).toBe(true)
    unmount()
  })

  it('logs session-open failures and falls back to the selected shell', async () => {
    openNewSession.mockRejectedValueOnce(new Error('shell failed'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHook(() => useMainLayoutBase(props({ appSettings: { ...settings, defaultShell: 'missing' } })))
    act(() => window.dispatchEvent(new Event('omniterm:new-session')))
    await waitFor(() => expect(openNewSession).toHaveBeenCalledWith('powershell', expect.any(Function)))
    await waitFor(() => expect(error).toHaveBeenCalled())
  })

  it('resizes and persists the sidebar, switches views, keeps previews, and reveals editors', async () => {
    const { result } = renderHook(() => useMainLayoutBase(props()))
    act(() => result.current.handleResizeDragStart({ preventDefault: vi.fn(), clientX: 100 } as any))
    await act(async () => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50 })) })
    expect(result.current.sidebarWidth).toBe(200)
    await act(async () => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1000 })) })
    expect(result.current.sidebarWidth).toBe(520)
    await act(async () => { window.dispatchEvent(new MouseEvent('mouseup')) })
    expect(localStorage.getItem('cc.sidebarWidth')).toBe('520')

    act(() => result.current.handleViewChange('files'))
    expect(result.current.activeView).toBe('files')
    act(() => result.current.setPreviewTabId('editor'))
    act(() => result.current.keepTab('editor'))
    expect(result.current.previewTabId).toBeNull()
    act(() => result.current.setEditorTabs({ editor: { workspaceId: 'w', script: { id: '/a.ts', name: 'a.ts', path: '/a.ts' } as any } }))
    act(() => result.current.revealInWorkspace('editor'))
    expect(result.current.revealRequest).toMatchObject({ workspaceId: 'w', path: '/a.ts', nonce: 1 })
    act(() => result.current.revealInWorkspace('missing'))
    expect(result.current.revealRequest?.nonce).toBe(1)
  })

  it('closes data menus from Escape and outside clicks but not inside references', async () => {
    const { result } = renderHook(() => useMainLayoutBase(props()))
    await waitFor(() => {
      expect(result.current.idleArtUrlLight).toBe('blob:idle-light')
      expect(result.current.idleArtUrlDark).toBe('blob:idle-dark')
      expect(result.current.loadingArtUrlLight).toBe('blob:loading-light')
      expect(result.current.loadingArtUrlDark).toBe('blob:loading-dark')
    })
    const menu = document.createElement('div')
    const button = document.createElement('button')
    document.body.append(menu, button)
    ;(result.current as any).dataMenuRef.current = menu
    ;(result.current as any).dataMenuBtnRef.current = button
    act(() => result.current.setDataMenuOpen(true))
    act(() => { fireEvent.mouseDown(document.body) })
    expect(result.current.dataMenuOpen).toBe(false)
    act(() => result.current.setDataMenuOpen(true))
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(result.current.dataMenuOpen).toBe(false)
    menu.remove(); button.remove()
  })


  it('bounds font size', () => {
    const p = props({ setAppSettings: vi.fn() })
    const { result } = renderHook(() => useMainLayoutBase(p))
    act(() => result.current.updateFontSize(100))
    expect(p.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 48 }))
    act(() => result.current.updateFontSize(-100))
    expect(p.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 8 }))
  })

})

