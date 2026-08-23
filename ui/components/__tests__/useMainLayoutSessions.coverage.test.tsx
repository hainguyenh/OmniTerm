/**
 * @vitest-environment jsdom
 */
import { useCallback, useRef, useState } from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, SessionStatus, WorkspaceScript } from '@omniterm/contract'
import { TOKYO_NIGHT, type LayoutMode } from '../../themes'
import { mockOmnitermAPI } from '../../testUtils'
import { useMainLayoutSessions } from '../useMainLayoutSessions'
import { createDefaultViewGroup, createViewGroup, DEFAULT_VIEW_GROUP_ID } from '../../viewGroups'
import { useViewGroups } from '../../hooks/useViewGroups'

const pairWithRun = vi.fn()
const noteShellOpen = vi.fn()
const runScript = vi.fn()
const detachStateOf = vi.fn(() => null)
const detachToggle = vi.fn()
vi.mock('../../hooks/useScriptRuns', () => ({
  editorTabId: (path: string) => `editor:${path}`,
  useScriptRuns: (options: any) => ({ pairWithRun, noteShellOpen, run: runScript, options }),
}))
vi.mock('../../hooks/useDetachControl', () => ({
  useDetachControl: () => ({ stateOf: detachStateOf, toggle: detachToggle }),
}))
vi.mock('../PaneHeader', () => ({
  default: (p: any) => <div data-testid="pane-header">
    <button onClick={p.onFocus}>focus</button><button onClick={p.onDragStart}>drag</button>
    <button onClick={p.onDragEnd}>end</button><button onClick={p.onTogglePicker}>picker</button>
    <button onClick={() => p.onAssign('assigned')}>assign</button><button onClick={p.onClear}>clear</button>
    <button onClick={p.onToggleDetach}>detach</button>
    {p.appearance && <><button onClick={() => p.appearance.onThemeApply('theme-x')}>theme</button><button onClick={() => p.appearance.onFontSizeChange(2)}>font</button></>}
  </div>,
}))

const local: Connection = { id: 'local', name: 'Local', type: 'LOCAL', host: '', port: '', user: '', shell: 'powershell' }
const ssh: Connection = { id: 'ssh', name: 'SSH', type: 'SSH', host: 'host', port: '22', user: 'me' }
const rdp: Connection = { id: 'rdp', name: 'RDP', type: 'RDP', host: 'desk', port: '3389', user: 'me' }
const editorScript: WorkspaceScript = { id: '/a.ts', name: 'a.ts', path: '/a.ts' } as WorkspaceScript
const showAlert = vi.fn(async () => {})
const showConfirm = vi.fn(async () => true)
const focusTerminal = vi.fn()
const onActiveTerminalChange = vi.fn()
const onThemeApply = vi.fn()
const onFontSizeChange = vi.fn()
let shellOpen: ((conn: unknown) => void) | undefined
let shellCleanup: ReturnType<typeof vi.fn>
let emitWindowClosed: ((id: string) => void) | undefined

interface Initial {
  tabs?: Array<{ id: string; connId: string; name: string }>
  panes?: (string | null)[]
  conns?: Connection[]
  statuses?: Record<string, SessionStatus>
  layoutMode?: LayoutMode
  focusedPane?: number
  activeView?: 'workspace' | 'files' | null
  editorTabs?: Record<string, { workspaceId: string; script: WorkspaceScript }>
  editorDirty?: Record<string, boolean>
  activity?: Record<string, boolean>
  previewTabId?: string | null
  poppedOut?: Record<string, boolean>
  resumeMode?: Record<string, boolean>
  settingsOpen?: boolean
  dataMenuOpen?: boolean
  panePicker?: number | null
  dragPane?: number | null
  useActualGroups?: boolean
}

function useHarness(initial: Initial = {}) {
  const [appSettings, setAppSettings] = useState<AppSettings>({ themeId: TOKYO_NIGHT.id, fontSize: 14, smartColors: true, checkUpdatesOnStartup: true, darkMode: true, split2Style: 'rows' })
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initial.layoutMode ?? 1)
  const [activeTabs, setActiveTabs] = useState(initial.tabs ?? [])
  const [ephemeralConns, setEphemeralConns] = useState<Connection[]>(initial.conns ?? [local, ssh, rdp])
  const [panes, setPanes] = useState<(string | null)[]>(initial.panes ?? Array(8).fill(null))
  const [focusedPane, setFocusedPane] = useState(initial.focusedPane ?? 0)
  const [mockViewGroups, setMockViewGroups] = useState<ReturnType<typeof createViewGroup>[]>(() => [{ ...createDefaultViewGroup(layoutMode), panes: [...(initial.panes ?? Array(8).fill(null))] }])
  const [mockActiveGroupId, setMockActiveGroupId] = useState(DEFAULT_VIEW_GROUP_ID)
  const [mockTabGroups, setMockTabGroups] = useState<Record<string, string>>({})
  const actualGroups = useViewGroups({ layoutMode, setLayoutMode, panes, setPanes, focusedPane, setFocusedPane })
  const viewGroups = initial.useActualGroups ? actualGroups.viewGroups : mockViewGroups
  const activeGroupId = initial.useActualGroups ? actualGroups.activeGroupId : mockActiveGroupId
  const tabGroups = initial.useActualGroups ? actualGroups.tabGroups : mockTabGroups
  const setTabGroups = initial.useActualGroups ? actualGroups.setTabGroups : setMockTabGroups
  const activeTabId = panes[focusedPane] ?? null
  const [panePicker, setPanePicker] = useState<number | null>(initial.panePicker ?? null)
  const panePickerRef = useRef<HTMLDivElement>(null)
  const [dragPane, setDragPane] = useState<number | null>(initial.dragPane ?? null)
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>(initial.statuses ?? {})
  const [reconnectKeys, setReconnectKeys] = useState<Record<string, number>>({})
  const [latencies, setLatencies] = useState<Record<string, number | null>>({ s1: 1 })
  const [detached, setDetached] = useState<Record<string, boolean>>({ s1: true })
  const [poppedOut, setPoppedOut] = useState<Record<string, boolean>>(initial.poppedOut ?? { s1: true })
  const [resumeMode, setResumeMode] = useState<Record<string, boolean>>(initial.resumeMode ?? { s1: true })
  const [metrics, setMetrics] = useState<Record<string, SessionMetrics>>({ s1: { latency: 1, cpu: 1, memUsed: 1, memTotal: 1, diskUsedPct: 1, ts: 1 } })
  const [connectedAt, setConnectedAt] = useState<Record<string, number>>({ s1: 1 })
  const [activity, setActivity] = useState<Record<string, boolean>>(initial.activity ?? { s1: true })
  const [pendingCloseTabIds, setPendingCloseTabIds] = useState<string[] | null>(null)
  const skipCloseConfirmRef = useRef(false)
  const [editorTabs, setEditorTabs] = useState(initial.editorTabs ?? {})
  const [editorDirty, setEditorDirty] = useState(initial.editorDirty ?? {})
  const [previewTabId, setPreviewTabId] = useState<string | null>(initial.previewTabId ?? null)
  const [activeView, setActiveView] = useState<'workspace' | 'files' | null>(initial.activeView ?? 'workspace')
  const handleConnectRef = useRef<(conn: Connection) => void>(() => undefined)
  const setStatus = useCallback((id: string, status: SessionStatus) => setStatuses(p => ({ ...p, [id]: status })), [])
  const connById = useCallback((id?: string) => ephemeralConns.find(c => c.id === id), [ephemeralConns])
  const switchMockViewGroup = useCallback((id: string) => {
    const group = viewGroups.find(item => item.id === id)
    if (!group) return
    setMockActiveGroupId(id); setLayoutMode(group.layoutMode); setPanes(group.panes); setFocusedPane(group.focusedPane)
  }, [viewGroups])
  const createMockViewGroup = useCallback((_tabId?: string, activate = true) => {
    if (activate && !_tabId) {
      setMockActiveGroupId(DEFAULT_VIEW_GROUP_ID); setLayoutMode(1); setPanes(Array(8).fill(null)); setFocusedPane(0)
      return DEFAULT_VIEW_GROUP_ID
    }
    const id = `view-${viewGroups.length + 1}`
    setMockViewGroups(prev => [...prev, { ...createViewGroup(id, prev.length), panes: _tabId ? [_tabId, ...Array(7).fill(null)] : Array(8).fill(null) }])
    if (activate) { setMockActiveGroupId(id); setLayoutMode(1); setPanes(Array(8).fill(null)); setFocusedPane(0) }
    return id
  }, [viewGroups.length])
  const switchViewGroup = initial.useActualGroups ? actualGroups.switchViewGroup : switchMockViewGroup
  const createNewViewGroup = initial.useActualGroups ? actualGroups.createNewViewGroup : createMockViewGroup
  const base: any = {
  sessionCwds: {}, workspaces: [],
    appSettings, setAppSettings, themes: [TOKYO_NIGHT], resolveAppearance: vi.fn(() => ({ themeId: TOKYO_NIGHT.id, fontSize: 17 })),
    onActiveTerminalChange, onFontSizeChange, onThemeApply, layoutMode, setLayoutMode, settingsOpen: initial.settingsOpen ?? false,
    activeTabs, setActiveTabs, tabGroups, setTabGroups, viewGroups, activeGroupId, switchViewGroup, createNewViewGroup, ephemeralConns, setEphemeralConns, panes, setPanes, focusedPane, setFocusedPane, activeTabId,
    setPendingCloseTabIds, skipCloseConfirmRef, panePicker, setPanePicker, panePickerRef, dragPane, setDragPane,
    statuses, setStatuses, setReconnectKeys, latencies, setLatencies, detached, setDetached, poppedOut, setPoppedOut,
    resumeMode, setResumeMode, metrics, setMetrics, connectedAt, setConnectedAt, setStatus, activity, setActivity,
    connById, toggleDetach: vi.fn(), canDetachWindow: true, popOutTerminal: vi.fn(), reattachTerminal: vi.fn(), focusTerminal,
    connFormOpen: false, showAlert, showConfirm, dataMenuOpen: initial.dataMenuOpen ?? false, activeView, setActiveView,
    editorTabs, setEditorTabs, editorDirty, setEditorDirty, previewTabId, setPreviewTabId, handleConnectRef,
  }
  const sessions = useMainLayoutSessions(base)
  return { base, sessions, pendingCloseTabIds, reconnectKeys }
}

beforeEach(() => {
  localStorage.clear()
  pairWithRun.mockReset(); noteShellOpen.mockReset(); runScript.mockReset()
  detachStateOf.mockReset().mockReturnValue(null); detachToggle.mockReset()
  showAlert.mockReset(); showConfirm.mockReset().mockResolvedValue(true); focusTerminal.mockReset()
  onActiveTerminalChange.mockReset(); onThemeApply.mockReset(); onFontSizeChange.mockReset()
  shellCleanup = vi.fn(); shellOpen = undefined; emitWindowClosed = undefined
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-1234-1234-123456789012')
  mockOmnitermAPI({
    shells: { onOpen: vi.fn((fn: (request: unknown) => void) => { shellOpen = fn; return shellCleanup }), ready: vi.fn(), release: vi.fn() },
    connect: { rdpDisconnect: vi.fn(), localDisconnect: vi.fn(), sshDisconnect: vi.fn(), rdpSetOverlay: vi.fn() },
    terminalWindow: {
      release: vi.fn(async () => {}),
      onClosed: vi.fn((fn: (id: string) => void) => { emitWindowClosed = fn; return vi.fn() }),
    },
  })
})
afterEach(() => vi.restoreAllMocks())

describe('useMainLayoutSessions complete behavior', () => {
  it('shows visible, empty, auto-fill-only, and replacement tabs', () => {
    const { result } = renderHook(() => useHarness({ tabs: [{ id: 'a', connId: 'ssh', name: 'A' }, { id: 'b', connId: 'rdp', name: 'B' }], panes: ['a', null, null, null, null, null, null, null], layoutMode: 2 }))
    act(() => result.current.sessions.showTab('a'))
    expect(result.current.base.focusedPane).toBe(0)
    act(() => result.current.sessions.showTab('b'))
    expect(result.current.base.panes.slice(0, 2)).toEqual(['a', 'b'])
    act(() => result.current.sessions.showTab('c', { autoFillOnly: true }))
    expect(result.current.base.panes.slice(0, 2)).toEqual(['a', 'b'])
    act(() => result.current.sessions.showTab('c'))
    expect(result.current.base.panes[1]).toBe('c')
  })

  it('expands, shrinks, assigns, clears, swaps, and reacts to layout events', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useHarness({ tabs: [{ id: 'a', connId: 'ssh', name: 'A' }, { id: 'b', connId: 'rdp', name: 'B' }, { id: 'c', connId: 'local', name: 'C' }], panes: ['a', null, null, null, null, 'b', null, null], layoutMode: 1, focusedPane: 5 }))
    act(() => result.current.sessions.changeLayoutMode(3))
    expect(result.current.base.layoutMode).toBe(3)
    expect(result.current.base.focusedPane).toBe(2)
    expect(result.current.base.panes.slice(0, 3).filter(Boolean).length).toBeGreaterThan(1)
    act(() => result.current.sessions.assignToPane(1, 'a'))
    expect(result.current.base.panes[1]).toBe('a')
    expect(result.current.base.panes[0]).toBeNull()
    act(() => result.current.sessions.clearPane(1))
    expect(result.current.base.panes[1]).toBeNull()
    act(() => result.current.sessions.swapPanes(0, 2))
    expect(result.current.base.focusedPane).toBe(2)
    const panes = result.current.base.panes
    act(() => { result.current.sessions.swapPanes(2, 2); result.current.sessions.swapPanes(Number.NaN, 1) })
    expect(result.current.base.panes).toBe(panes)
    act(() => window.dispatchEvent(new CustomEvent('omniterm:change-layout', { detail: { mode: 4 } })))
    expect(result.current.base.layoutMode).toBe(4)
    expect(setItem).toHaveBeenCalledWith('cc.layoutMode', '4')
  })

  it('preserves the focused terminal when shrinking a multi-pane layout', () => {
    const tabs = [
      { id: 'a', connId: 'local', name: 'A' },
      { id: 'b', connId: 'ssh', name: 'B' },
      { id: 'c', connId: 'rdp', name: 'C' },
      { id: 'd', connId: 'local', name: 'D' },
    ]
    const { result } = renderHook(() => useHarness({
      tabs,
      panes: ['a', 'b', 'c', 'd', null, null, null, null],
      layoutMode: 4,
      focusedPane: 3,
    }))

    act(() => result.current.sessions.changeLayoutMode(2))

    expect(result.current.base.panes.slice(0, 2)).toEqual(['a', 'd'])
    expect(result.current.base.focusedPane).toBe(1)
    expect(result.current.base.activeTabs.map((tab: { id: string }) => tab.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps tabs and the active group through repeated multi-view changes', () => {
    const tabs = [
      { id: 'a', connId: 'local', name: 'A' },
      { id: 'b', connId: 'ssh', name: 'B' },
      { id: 'c', connId: 'rdp', name: 'C' },
      { id: 'd', connId: 'local', name: 'D' },
    ]
    const { result } = renderHook(() => useHarness({
      useActualGroups: true,
      tabs,
      panes: ['a', 'b', 'c', 'd', null, null, null, null],
      layoutMode: 4,
      focusedPane: 0,
    }))

    act(() => result.current.sessions.changeLayoutMode(2))
    act(() => result.current.sessions.changeLayoutMode(3))
    act(() => result.current.sessions.changeLayoutMode(1))

    expect(result.current.base.activeTabs.map((tab: { id: string }) => tab.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.current.base.panes[0]).toBe('a')
    expect(result.current.base.viewGroups.length).toBeGreaterThan(0)
  })

  it('opens repeatable local sessions, single remote sessions, and shell events', async () => {
    const { result, unmount } = renderHook(() => useHarness())
    act(() => result.current.sessions.handleConnect(local))
    expect(result.current.base.activeTabs[0]).toMatchObject({ id: 'local_12345678', name: 'Local' })
    act(() => result.current.sessions.handleConnect(local))
    expect(result.current.base.activeTabs[1].name).toBe('Local (2)')
    act(() => result.current.sessions.handleConnect(ssh))
    act(() => result.current.sessions.handleConnect(ssh))
    expect(result.current.base.activeTabs.filter((t: any) => t.connId === 'ssh')).toHaveLength(1)
    expect(window.omnitermAPI.shells.ready).toHaveBeenCalled()
    act(() => shellOpen?.({ ...local, id: 'event-shell', localCommand: 'echo hi' }))
    await waitFor(() => expect(noteShellOpen).toHaveBeenCalledWith('event-shell', true))
    expect(result.current.base.ephemeralConns.some((c: Connection) => c.id === 'event-shell')).toBe(true)
    unmount()
    expect(shellCleanup).toHaveBeenCalled()
  })

  it('keeps a newly created terminal when switching from single view to a two-pane group', () => {
    const existing = { id: 'existing', connId: 'local', name: 'Existing' }
    type TestTab = { id: string; connId: string; name: string }
    const { result } = renderHook(() => useHarness({
      useActualGroups: true,
      tabs: [existing],
      panes: [existing.id, null, null, null, null, null, null, null],
      layoutMode: 1,
    }))

    act(() => result.current.sessions.handleConnect(local))
    const newTabId = result.current.base.activeTabs.find((tab: TestTab) => tab.id !== existing.id)?.id
    expect(newTabId).toBe('local_12345678')
    expect(result.current.base.panes).toEqual([newTabId, ...Array(7).fill(null)])

    act(() => result.current.sessions.changeLayoutMode(2))

    expect(result.current.base.activeTabs.map((tab: TestTab) => tab.id)).toEqual([existing.id, newTabId])
    expect(result.current.base.panes.slice(0, 2)).toEqual([newTabId, existing.id])
    expect(result.current.base.viewGroups.filter((group: ReturnType<typeof createViewGroup>) => group.id !== DEFAULT_VIEW_GROUP_ID)).toHaveLength(1)
    expect(result.current.base.activeGroupId).not.toBe(DEFAULT_VIEW_GROUP_ID)
  })

  it('creates a visible group for the first terminal when two-pane mode is selected', () => {
    const { result } = renderHook(() => useHarness({ useActualGroups: true }))

    act(() => result.current.sessions.handleConnect(local))
    act(() => result.current.sessions.changeLayoutMode(2))

    expect(result.current.base.activeTabs).toHaveLength(1)
    expect(result.current.base.panes[0]).toBe(result.current.base.activeTabs[0].id)
    expect(result.current.base.panes[1]).toBeNull()
    expect(result.current.base.viewGroups.filter((group: ReturnType<typeof createViewGroup>) => group.id !== DEFAULT_VIEW_GROUP_ID)).toHaveLength(1)
    expect(result.current.base.activeGroupId).not.toBe(DEFAULT_VIEW_GROUP_ID)
  })

  it('opens a standalone single view when every pane in the active view is occupied', () => {
    const { result } = renderHook(() => useHarness({
      tabs: [{ id: 'a', connId: 'local', name: 'A' }, { id: 'b', connId: 'ssh', name: 'B' }],
      panes: ['a', 'b', null, null, null, null, null, null],
      layoutMode: 2,
    }))

    act(() => result.current.base.setTabGroups({ a: 'old-group', b: 'old-group' }))
    act(() => result.current.sessions.handleConnect(local))

    expect(result.current.base.activeTabs).toHaveLength(3)
    expect(result.current.base.viewGroups).toHaveLength(1)
    expect(result.current.base.activeGroupId).toBe(DEFAULT_VIEW_GROUP_ID)
    expect(result.current.base.panes[0]).toMatch(/^local_/)
    expect(result.current.base.panes.slice(1)).toEqual(Array(7).fill(null))
  })

  it('keeps the explicit group available when a new tab opens from a full group', () => {
    const { result } = renderHook(() => useHarness({
      tabs: [{ id: 'a', connId: 'local', name: 'A' }, { id: 'b', connId: 'ssh', name: 'B' }],
      panes: ['a', 'b', null, null, null, null, null, null],
      layoutMode: 2,
    }))
    let groupId = ''
    act(() => { groupId = result.current.base.createNewViewGroup('a', false) })
    act(() => {
      result.current.base.switchViewGroup(groupId)
      result.current.base.setPanes(['a', 'b', null, null, null, null, null, null])
      result.current.base.setTabGroups({ a: groupId, b: groupId })
      result.current.base.setLayoutMode(2)
    })

    act(() => result.current.sessions.handleConnect(local))

    expect(result.current.base.activeGroupId).toBe(DEFAULT_VIEW_GROUP_ID)
    expect(result.current.base.viewGroups.some((group: ReturnType<typeof createViewGroup>) => group.id === groupId)).toBe(true)
    expect(result.current.base.panes[0]).toMatch(/^local_/)
  })

  it('expands only the active group instead of borrowing tabs from another group', () => {
    const { result } = renderHook(() => useHarness({
      tabs: [{ id: 'a', connId: 'local', name: 'A' }, { id: 'b', connId: 'ssh', name: 'B' }],
      panes: ['a', 'b', null, null, null, null, null, null],
      layoutMode: 2,
    }))

    act(() => result.current.base.setTabGroups({ a: 'old-group', b: 'old-group' }))
    act(() => result.current.sessions.handleConnect(local))
    act(() => result.current.sessions.changeLayoutMode(2))

    expect(result.current.base.panes[0]).toMatch(/^local_/)
    expect(result.current.base.panes[1]).toBeNull()
  })

  it('pairs editor runs, converts row layout, reuses editors, and replaces stale previews', () => {
    const stale = { id: 'editor:/old.ts', connId: 'editor:/old.ts', name: 'old.ts' }
    const { result } = renderHook(() => useHarness({ tabs: [stale], panes: [stale.id, null, null, null, null, null, null, null], layoutMode: 1, previewTabId: stale.id, editorTabs: { [stale.id]: { workspaceId: 'w', script: { ...editorScript, id: '/old.ts', path: '/old.ts', name: 'old.ts' } as WorkspaceScript } } }))
    act(() => result.current.sessions.openEditor('w', editorScript))
    expect(result.current.base.activeTabs.some((t: any) => t.id === 'editor:/a.ts')).toBe(true)
    expect(result.current.base.activeTabs.some((t: any) => t.id === stale.id)).toBe(false)
    expect(pairWithRun).toHaveBeenCalledWith('/a.ts', 'editor:/a.ts')
    act(() => result.current.sessions.pairRunWithEditor('terminal', 'editor:/a.ts'))
    expect(result.current.base.panes.slice(0, 2)).toEqual(['terminal', 'editor:/a.ts'])
    expect(result.current.base.appSettings.split2Style).toBe('columns')
    expect(result.current.base.layoutMode).toBe(2)
    act(() => result.current.sessions.openEditor('w', editorScript))
    expect(result.current.base.activeTabs.filter((t: any) => t.id === 'editor:/a.ts')).toHaveLength(1)
  })

  it('disconnects each connection type and unknown sessions through SSH fallback', () => {
    const { result } = renderHook(() => useHarness({ tabs: [{ id: 'l', connId: 'local', name: 'L' }, { id: 's', connId: 'ssh', name: 'S' }, { id: 'r', connId: 'rdp', name: 'R' }] }))
    act(() => {
      result.current.sessions.disconnectByType('l', 'local')
      result.current.sessions.disconnectByType('s', 'ssh')
      result.current.sessions.disconnectByType('r', 'rdp')
      result.current.sessions.disconnectSession('unknown')
    })
    expect(window.omnitermAPI.connect.localDisconnect).toHaveBeenCalledWith('l')
    expect(window.omnitermAPI.connect.sshDisconnect).toHaveBeenCalledWith('s')
    expect(window.omnitermAPI.connect.rdpDisconnect).toHaveBeenCalledWith('r')
    expect(window.omnitermAPI.connect.sshDisconnect).toHaveBeenCalledWith('unknown')
  })

  it('defers active session closing, force-closes tabs, releases windows/shells, and prunes state', () => {
    const tabs = [{ id: 's1', connId: 'local', name: 'L' }, { id: 's2', connId: 'ssh', name: 'S' }]
    const { result } = renderHook(() => useHarness({ tabs, panes: ['s1', null, null, null, null, null, null, null], statuses: { s1: 'connected', s2: 'closed' }, poppedOut: { s1: true }, conns: [local, ssh] }))
    act(() => result.current.sessions.closeTabs(['s1']))
    expect(result.current.pendingCloseTabIds).toEqual(['s1'])
    expect(result.current.base.activeTabs).toHaveLength(2)
    act(() => result.current.sessions.closeTabs(['s1'], true))
    expect(result.current.base.activeTabs.map((t: any) => t.id)).toEqual(['s2'])
    expect(window.omnitermAPI.terminalWindow.release).toHaveBeenCalledWith('s1')
    expect(window.omnitermAPI.connect.localDisconnect).toHaveBeenCalledWith('s1')
    expect(window.omnitermAPI.shells.release).toHaveBeenCalledWith('local')
    expect(result.current.base.statuses.s1).toBeUndefined()
    const tabsAfter = result.current.base.activeTabs
    act(() => { result.current.sessions.closeTabs([]); result.current.sessions.clearTabState([]) })
    expect(result.current.base.activeTabs).toBe(tabsAfter)
  })

  it('closes an idle local shell immediately without confirmation', () => {
    const { result } = renderHook(() => useHarness({
      tabs: [{ id: 's1', connId: 'local', name: 'Local' }],
      panes: ['s1', null, null, null, null, null, null, null],
      statuses: { s1: 'connected' },
      activity: { s1: false },
      conns: [local],
    }))

    act(() => result.current.sessions.closeTab('s1'))

    expect(showConfirm).not.toHaveBeenCalled()
    expect(result.current.base.activeTabs).toEqual([])
    expect(window.omnitermAPI.connect.localDisconnect).toHaveBeenCalledWith('s1')
  })

  it('removes the tab when backend closes an idle detached session without killing it twice', () => {
    const { result } = renderHook(() => useHarness({
      tabs: [{ id: 's1', connId: 'local', name: 'Local' }],
      panes: ['s1', null, null, null, null, null, null, null],
      statuses: { s1: 'closed' },
      poppedOut: { s1: true },
    }))

    act(() => emitWindowClosed?.('s1'))

    expect(result.current.base.activeTabs).toEqual([])
    expect(window.omnitermAPI.connect.localDisconnect).not.toHaveBeenCalled()
    expect(window.omnitermAPI.terminalWindow.release).not.toHaveBeenCalled()
  })

  it('confirms dirty editor closes, preserves canceled edits, and removes clean editors', async () => {
    showConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const id = 'editor:/a.ts'
    const initial = { tabs: [{ id, connId: id, name: 'a.ts' }], editorTabs: { [id]: { workspaceId: 'w', script: editorScript } }, editorDirty: { [id]: true }, panes: [id, null, null, null, null, null, null, null] }
    const { result } = renderHook(() => useHarness(initial))
    act(() => result.current.sessions.closeTab(id))
    await waitFor(() => expect(showConfirm).toHaveBeenCalled())
    expect(result.current.base.activeTabs).toHaveLength(1)
    act(() => result.current.sessions.closeTab(id))
    await waitFor(() => expect(result.current.base.activeTabs).toHaveLength(0))
    expect(result.current.base.editorTabs[id]).toBeUndefined()
    expect(window.omnitermAPI.connect.sshDisconnect).not.toHaveBeenCalled()
  })

  it('reconnects, ranks connection states, redirects invalid file view, and reports active terminal', async () => {
    const tabs = [{ id: 's1', connId: 'ssh', name: 'SSH' }, { id: 's2', connId: 'ssh', name: 'SSH 2' }]
    const { result } = renderHook(() => useHarness({ tabs, panes: ['s1', null, null, null, null, null, null, null], statuses: { s1: 'connected', s2: 'error' }, activeView: 'files', resumeMode: { s1: true } }))
    await waitFor(() => expect(result.current.sessions.activeSshId).toBe('s1'))
    expect(result.current.sessions.activeSshName).toBe('SSH')
    expect(result.current.sessions.connStatuses.ssh).toBe('connected')
    expect(onActiveTerminalChange).toHaveBeenCalledWith({ id: 's1', connId: 'ssh' })
    act(() => result.current.sessions.reconnectSession('s1'))
    expect(result.current.base.statuses.s1).toBe('connecting')
    expect(result.current.base.resumeMode.s1).toBe(false)
    expect(result.current.reconnectKeys.s1).toBe(1)
    act(() => result.current.base.setStatuses({ s1: 'closed', s2: 'error' }))
    await waitFor(() => expect(result.current.base.activeView).toBe('workspace'))
    expect(localStorage.getItem('cc.activeView')).toBe('workspace')
  })

  it('tracks overlay state, focuses visible terminals, closes pickers, and handles close-tab events', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useHarness({ tabs: [{ id: 's1', connId: 'ssh', name: 'SSH' }], panes: ['s1', null, null, null, null, null, null, null], statuses: { s1: 'closed' }, panePicker: 0 }))
    expect(window.omnitermAPI.connect.rdpSetOverlay).toHaveBeenCalledWith(true)
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(result.current.base.panePicker).toBeNull()
    expect(focusTerminal).toHaveBeenCalledWith('s1')
    act(() => window.dispatchEvent(new Event('omniterm:close-tab')))
    act(() => vi.runAllTimers())
    expect(result.current.base.activeTabs).toHaveLength(0)
    vi.useRealTimers()
  })

  it('renders pane header callbacks, appearance, and detach controls', () => {
    detachStateOf.mockReturnValue('detach' as any)
    const { result } = renderHook(() => useHarness({ tabs: [{ id: 's1', connId: 'ssh', name: 'SSH' }], panes: ['s1', null, null, null, null, null, null, null] }))
    render(result.current.sessions.renderPaneHeader(0, ssh))
    for (const label of ['focus', 'drag', 'end', 'picker', 'assign', 'clear', 'detach', 'theme', 'font']) fireEvent.click(screen.getByText(label))
    expect(result.current.base.focusedPane).toBe(0)
    expect(result.current.base.dragPane).toBeNull()
    expect(detachToggle).toHaveBeenCalledWith('s1')
    expect(onThemeApply).toHaveBeenCalledWith('theme-x', { id: 's1', connId: 'ssh' })
    expect(onFontSizeChange).toHaveBeenCalledWith(2, { id: 's1', connId: 'ssh' })
  })
})
