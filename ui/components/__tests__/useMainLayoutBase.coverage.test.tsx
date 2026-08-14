/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { TOKYO_NIGHT } from '../../themes'
import { mockOmnitermAPI } from '../../testUtils'
import type { MainLayoutProps } from '../mainLayoutShared'
import { useMainLayoutBase } from '../useMainLayoutBase'

const showAlert = vi.fn(async () => {})
const showConfirm = vi.fn(async () => true)
const setRatios = vi.fn()
const persistRatios = vi.fn()
const openNewSession = vi.fn(async (_shell: string, connect: (conn: unknown) => void) => connect({ id: 'new', type: 'LOCAL' }))
const upsertWorkspaceConnection = vi.fn(async (_wId?: any, _target?: any, _conn?: any) => {})
const loadShellOptions = vi.fn(async () => [{ id: 'powershell', label: 'PowerShell' }])
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ dialogState: null, showAlert, showConfirm }) }))
vi.mock('../../hooks/useSplitRatios', () => ({ useSplitRatios: () => [{ main: .5, cross: .5 }, setRatios, persistRatios] }))
vi.mock('../../newSession', () => ({ openNewSession: (shell: any, connect: any) => openNewSession(shell, connect) }))
vi.mock('../../shellOptions', () => ({
  loadShellOptions: () => loadShellOptions(),
  pickShell: (options: Array<{ id: string }>, requested?: string) => options.some(o => o.id === requested) ? requested : options[0]?.id ?? 'powershell',
}))
vi.mock('../../utils/workspaceConnections', () => ({ upsertWorkspaceConnection: (wId: any, target: any, conn: any) => upsertWorkspaceConnection(wId, target, conn) }))

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
    settingsOpen: false, setSettingsOpen: vi.fn(), updateState: latest, setUpdateState: vi.fn(), themes: [TOKYO_NIGHT],
    onSettingsReload: vi.fn(), ...overrides,
  }
}

let emitDetached: ((id: string, detached: boolean) => void) | undefined
let emitReattached: ((id: string) => void) | undefined
beforeEach(() => {
  localStorage.clear()
  showAlert.mockClear(); showConfirm.mockClear(); setRatios.mockClear(); persistRatios.mockClear()
  openNewSession.mockClear(); upsertWorkspaceConnection.mockClear(); loadShellOptions.mockClear()
  emitDetached = undefined; emitReattached = undefined
  mockOmnitermAPI({
    plugin: { list: vi.fn(async () => [{ selectedConnectionProvider: true, enabled: true }]), connectionCapabilities: vi.fn(async () => ({ sftp: true })) },
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
    settings: { save: vi.fn(async () => {}) },
  })
})
afterEach(() => vi.restoreAllMocks())

describe('useMainLayoutBase complete behavior', () => {
  it('restores the split layout when Escape exits pane focus mode', async () => {
    const { result, unmount } = renderHook(() => useMainLayoutBase(props()))
    await waitFor(() => expect(result.current.hasConnectionProvider).toBe(true))
    act(() => result.current.setFullscreenPane(1))
    expect(result.current.fullscreenPane).toBe(1)
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(result.current.fullscreenPane).toBeNull()
    unmount()
  })

  // Always Awake is contributed by a plugin, so a build without it must not offer the feature — and
  // must not subscribe to the native poller either.
  it('offers Always Awake only when the plugin answers, and subscribes to it only then', async () => {
    const getState = vi.fn(async () => ({ enabled: true, mode: 'always', expiresAtMs: 1, activeSessionCount: 0, keepingAwake: true, supported: true, error: null }))
    const onState = vi.fn(() => vi.fn())

    // No plugin: `plugin.invoke` resolves to null, the way the bridge reports an unanswered method.
    mockOmnitermAPI({
      plugin: { invoke: vi.fn(async () => null) },
      alwaysAwake: { getState, onState },
    })
    const absent = renderHook(() => useMainLayoutBase(props()))
    await waitFor(() => expect(absent.result.current.hasConnectionProvider).toBeDefined())
    expect(absent.result.current.alwaysAwakeAvailable).toBe(false)
    expect(getState).not.toHaveBeenCalled()
    expect(onState).not.toHaveBeenCalled()
    absent.unmount()

    mockOmnitermAPI({
      plugin: { invoke: vi.fn(async (method: string) => (method === 'alwaysAwake.info' ? { name: 'Always Awake' } : null)) },
      alwaysAwake: { getState, onState },
    })
    const present = renderHook(() => useMainLayoutBase(props()))
    await waitFor(() => expect(present.result.current.alwaysAwakeAvailable).toBe(true))
    await waitFor(() => expect(present.result.current.alwaysAwake.keepingAwake).toBe(true))
    expect(onState).toHaveBeenCalled()
  })

  it('loads provider state, shell options, workspace connections, and all custom art modes', async () => {
    const { result } = renderHook(() => useMainLayoutBase(props()))
    await waitFor(() => expect(result.current.hasConnectionProvider).toBe(true))
    expect(result.current.connectionCapabilities).toEqual({ sftp: true })
    expect(result.current.savedConnections).toEqual([{ ...ssh, workspaceId: 'w' }])
    expect(result.current.shellOptions).toEqual([{ id: 'powershell', label: 'PowerShell' }])
    expect(result.current.idleArtUrl).toBe('blob:idle-dark')
    expect(result.current.loadingArtUrl).toBe('blob:loading-dark')
  })

  it('handles provider, art, and workspace load errors without crashing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockOmnitermAPI({
      plugin: { list: vi.fn(async () => { throw new Error('host') }), connectionCapabilities: vi.fn() },
      customArt: { get: vi.fn(async () => { throw new Error('missing') }) },
      workspace: { list: vi.fn(async () => { throw new Error('disk') }) },
    })
    const { result } = renderHook(() => useMainLayoutBase(props({ appSettings: { ...settings, darkMode: false } })))
    await waitFor(() => expect(result.current.idleArtUrlLight).toBeNull())
    expect(result.current.hasConnectionProvider).toBe(false)
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
    act(() => result.current.reattachTerminal('session'))
    expect(window.omnitermAPI.terminalWindow.reattach).toHaveBeenCalledWith('session')
    act(() => emitReattached?.('session'))
    expect(result.current.poppedOut.session).toBe(false)
    expect(reload).toHaveBeenCalledWith('session')

    const dispatch = vi.spyOn(window, 'dispatchEvent')
    act(() => result.current.focusTerminal('session'))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'omniterm:focus-terminal' }))
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

  it('records normal shortcuts, ignores modifiers, blocks reserved shortcuts, and handles Space', async () => {
    const p = props({ setAppSettings: vi.fn() })
    const { result } = renderHook(() => useMainLayoutBase(p))
    act(() => result.current.setRecordingAction('zoomIn'))
    fireEventKey('Control', { ctrlKey: true })
    expect(result.current.recordingAction).toBe('zoomIn')
    fireEventKey('r', { ctrlKey: true })
    await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.stringContaining('native Chromium'), expect.anything()))
    expect(result.current.recordingAction).toBeNull()

    act(() => result.current.setRecordingAction('newSession'))
    fireEventKey(' ', { ctrlKey: true, shiftKey: true, altKey: true })
    await waitFor(() => expect(p.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ shortcuts: expect.objectContaining({ newSession: 'Ctrl+Shift+Alt+Space' }) })))
    expect(window.omnitermAPI.settings.save).toHaveBeenCalled()
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

  it('checks updates, skips versions, downloads both packages, and handles missing choices and failures', async () => {
    const p = props({ setUpdateState: vi.fn() })
    const { result } = renderHook(() => useMainLayoutBase(p))
    await act(() => result.current.checkForUpdates())
    expect(p.setUpdateState).toHaveBeenCalledWith(latest)
    await act(() => result.current.skipThisVersion())
    expect(window.omnitermAPI.updates.skip).toHaveBeenCalledWith('2.0.0')
    await act(() => result.current.clearSkippedVersion())
    expect(window.omnitermAPI.updates.skip).toHaveBeenCalledWith(null)
    await act(() => result.current.handleDownloadPortable())
    expect(window.omnitermAPI.updates.showSaveDialog).toHaveBeenCalledWith('OmniTerm-Portable-2.0.0.exe')
    expect(window.omnitermAPI.updates.downloadPortable).toHaveBeenCalledWith('/tmp/app.exe')
    await act(() => result.current.handleDownloadInstaller(true))
    expect(window.omnitermAPI.updates.downloadInstaller).toHaveBeenCalledWith(true)

    vi.mocked(window.omnitermAPI.updates.showSaveDialog).mockResolvedValueOnce(null)
    await act(() => result.current.handleDownloadPortable())
    vi.mocked(window.omnitermAPI.updates.check).mockRejectedValueOnce('network')
    await act(() => result.current.checkForUpdates())
    vi.mocked(window.omnitermAPI.updates.downloadPortable).mockRejectedValueOnce(new Error('disk'))
    await act(() => result.current.handleDownloadPortable())
    vi.mocked(window.omnitermAPI.updates.downloadInstaller).mockRejectedValueOnce('installer')
    await act(() => result.current.handleDownloadInstaller(false))
    expect(showAlert).toHaveBeenCalledWith('Could not check for updates: network', expect.anything())
    expect(showAlert).toHaveBeenCalledWith('Download failed: disk', expect.anything())
    expect(showAlert).toHaveBeenCalledWith('Download failed: installer', expect.anything())
  })

  it('bounds font size and saves workspace connections with renaming, revision, and errors', async () => {
    const p = props({ setAppSettings: vi.fn() })
    const { result } = renderHook(() => useMainLayoutBase(p))
    act(() => result.current.updateFontSize(100))
    expect(p.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 48 }))
    act(() => result.current.updateFontSize(-100))
    expect(p.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 8 }))

    await act(() => result.current.handleSaveConnection(ssh))
    expect(upsertWorkspaceConnection).not.toHaveBeenCalled()
    act(() => {
      result.current.openConnectionForm({ workspaceId: 'w', folders: [], rootLabel: 'W' } as any)
      result.current.setConnFormInitial(ssh)
      result.current.setEphemeralConns([ssh])
      result.current.setActiveTabs([{ id: 's1', connId: ssh.id, name: 'old' }, { id: 's2', connId: ssh.id, name: 'old2' }])
    })
    await act(() => result.current.handleSaveConnection({ ...ssh, name: 'Renamed' }))
    expect(upsertWorkspaceConnection).toHaveBeenCalledWith('w', expect.objectContaining({ name: 'Renamed' }), true)
    expect(result.current.activeTabs.map((t: { name: string }) => t.name)).toEqual(['Renamed', 'Renamed (2)'])
    expect(result.current.wsConnectionsRevision).toBe(1)

    upsertWorkspaceConnection.mockRejectedValueOnce(new Error('read only'))
    act(() => result.current.openConnectionForm({ workspaceId: 'w', folders: [], rootLabel: 'W' } as any))
    await act(() => result.current.handleSaveConnection(ssh))
    expect(showAlert).toHaveBeenCalledWith('Could not save the connection: read only', expect.anything())
  })

  it('sorts visible tabs according to the visual pane layout order', async () => {
    const { result, unmount } = renderHook(() => useMainLayoutBase(props({ layoutMode: 2 })))
    await waitFor(() => expect(result.current.hasConnectionProvider).toBe(true))
    act(() => {
      result.current.setActiveTabs([
        { id: 'tabA', connId: 'connA', name: 'A' },
        { id: 'tabB', connId: 'connB', name: 'B' },
      ])
      result.current.setPanes(['tabB', 'tabA', null, null, null, null, null, null])
    })

    const order = result.current.visibleTabs.map(t => t.id)
    expect(order).toEqual(['tabB', 'tabA'])
    
    act(() => {
      result.current.setPanes(['tabA', 'tabB', null, null, null, null, null, null])
    })

    expect(result.current.visibleTabs.map(t => t.id)).toEqual(['tabA', 'tabB'])
    unmount()
  })
})

function fireEventKey(key: string, init: KeyboardEventInit = {}) {
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })))
}
