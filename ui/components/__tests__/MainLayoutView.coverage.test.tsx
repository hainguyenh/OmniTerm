/**
 * @vitest-environment jsdom
 */
import { createRef } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { TOKYO_NIGHT } from '../../themes'
import { mockOmnitermAPI } from '../../testUtils'
import MainLayoutView from '../MainLayoutView'
import type { MainLayoutModel } from '../useMainLayoutController'

vi.mock('../ActivityBar', () => ({ default: (p: any) => <div data-testid="activity"><button onClick={() => p.onViewChange('workspace')}>view</button><button onClick={p.onSettingsClick}>settings</button><span>{String(p.filesEnabled)}</span></div> }))
vi.mock('../WorkspacePanel', () => ({ default: (p: any) => <div data-testid="workspace"><button onClick={() => p.onOpenScript?.('w', { path: '/x.ts' })}>open-script</button><button onClick={() => p.onRunScript?.('w', { path: '/x.ts' })}>run-script</button><button onClick={() => p.onAddWorkspaceConnection?.({ workspaceId: 'w', folders: [], rootLabel: 'W' })}>add-conn</button><button onClick={() => p.onEditWorkspaceConnection?.({ workspaceId: 'w', folders: [], rootLabel: 'W' }, { id: 'c' })}>edit-conn</button></div> }))
vi.mock('../FileBrowser', () => ({ default: (p: any) => <div data-testid="files">{p.id}:{p.connectionName}:{String(p.active)}</div> }))
vi.mock('../SessionTabs', () => ({ default: (p: any) => <div data-testid="tabs"><button onClick={() => p.onSelect(p.tabs[0].id)}>select-tab</button><button onClick={() => p.onPromote(p.tabs[0].id)}>promote-tab</button><button onClick={() => p.onClose(p.tabs[0].id)}>close-tab</button><button onContextMenu={(e: React.MouseEvent<HTMLButtonElement>) => p.onContextMenu(e, p.tabs[0].id)}>menu-tab</button><button title="New Terminal (Ctrl+N)" onClick={() => p.onNewSession()}>new-tab</button><button onClick={() => p.onPickShell({ left: 2, bottom: 3 })}>shell-tab</button><button onClick={() => p.onReveal(p.tabs[0].id)}>reveal-tab</button>{p.detachAction && <button onClick={p.onToggleDetach}>toggle-detach</button>}</div> }))
vi.mock('../WaitingPane', () => ({ default: (p: any) => <div data-testid={p.compact ? `waiting-${p.paneIndex}` : 'waiting'}><button onClick={p.onNewSession}>new-wait</button><button onClick={() => p.onPickShell({ left: 4, bottom: 5 })}>shell-wait</button>{p.onChooseSession && <button onClick={p.onChooseSession}>choose-wait</button>}</div> }))
vi.mock('../ScriptViewer', () => ({ default: (p: any) => <div data-testid="editor"><button onClick={p.onRun}>run-editor</button><button onClick={p.onClose}>close-editor</button><button onClick={() => p.onDirtyChange(true)}>dirty-editor</button><button onClick={() => p.onDirtyChange(false)}>clean-editor</button></div> }))
vi.mock('../TerminalView', () => ({ default: (p: any) => <div data-testid={`terminal-${p.id}`} data-mode={p.mode} data-font={p.fontSize}><button onClick={() => p.onStatus('connected')}>terminal-status</button><button onClick={() => p.onMetrics({ latency: 7 })}>terminal-metrics</button><button onClick={() => p.onActivity(true)}>terminal-busy</button><button onClick={() => p.onExit(0)}>terminal-exit</button>{p.onFontSizeChange && <button onClick={() => p.onFontSizeChange(p.fontSize + 2)}>terminal-font</button>}</div> }))
vi.mock('../RDPView', () => ({ default: (p: any) => <div data-testid={`rdp-${p.id}`} data-active={String(p.active)}><button onClick={() => p.onStatus('connected')}>rdp-status</button><button onClick={() => p.onLatency(33)}>rdp-latency</button></div> }))
vi.mock('../ConnectingOverlay', () => ({ default: () => <div data-testid="connecting" /> }))
vi.mock('../DetachedPlaceholder', () => ({ default: (p: any) => <div data-testid="detached"><button onClick={p.onFocus}>focus-detached</button><button onClick={p.onReattach}>reattach-detached</button></div> }))
vi.mock('../ConnectionForm', () => ({ default: (p: any) => <div data-testid="connection-form"><button onClick={() => p.onSave({ id: 'saved' })}>save-form</button><button onClick={p.onClose}>close-form</button></div> }))
vi.mock('../SessionMetricsChips', () => ({ default: (p: any) => <div data-testid="metrics">{p.status}:{String(p.latency)}:{String(p.compact)}</div> }))
vi.mock('../PaneResizers', () => ({ PaneResizers: (p: any) => <div data-testid="resizers"><button onClick={() => p.onChange({ main: .4, cross: .6 })}>resize-pane</button><button onClick={p.onCommit}>commit-pane</button></div> }))
vi.mock('../MainLayoutOverlays', () => ({ default: () => <div data-testid="overlays" /> }))

const local: Connection = { id: 'local', name: 'Local', type: 'LOCAL', host: '', port: '', user: '', shell: 'powershell' }
const ssh: Connection = { id: 'ssh', name: 'SSH', type: 'SSH', host: 'server', port: '22', user: 'me' }
const rdp: Connection = { id: 'rdp', name: 'RDP', type: 'RDP', host: 'desk', port: '3389', user: 'me' }

function model(overrides: Record<string, unknown> = {}): MainLayoutModel {
  const connections = [local, ssh, rdp]
  const base: Record<string, any> = {
    appSettings: { themeId: TOKYO_NIGHT.id, fontSize: 14, smartColors: true, darkMode: true, splitRatios: { main: .5, cross: .5 } },
    setAppSettings: vi.fn(), currentTheme: TOKYO_NIGHT, themes: [TOKYO_NIGHT], zoomFactor: 1.25,
    onZoomReset: vi.fn(), resolveAppearance: vi.fn(() => ({})), onFontSizeChange: vi.fn(),
    layoutMode: 1, setSettingsOpen: vi.fn(), hasConnectionProvider: true,
    connectionCapabilities: { sftp: true }, activeTabs: [], ephemeralConns: [], panes: [null],
    focusedPane: 0, setFocusedPane: vi.fn(), activeTabId: null, setTabMenu: vi.fn(), setShellMenu: vi.fn(),
    setPanePicker: vi.fn(), dragPane: null, setDragPane: vi.fn(), statuses: {}, reconnectKeys: {}, latencies: {},
    poppedOut: {}, resumeMode: {}, metrics: {}, connectedAt: {}, setStatus: vi.fn(), setLatency: vi.fn(),
    setMetric: vi.fn(), activity: {}, setBusy: vi.fn(), connById: (id?: string) => connections.find(c => c.id === id),
    updateFontSize: vi.fn(), reattachTerminal: vi.fn(), connFormOpen: false, setConnFormOpen: vi.fn(),
    connFormInitial: undefined, setConnFormInitial: vi.fn(), connFormTarget: null, wsConnFormRef: createRef<string | null>(),
    wsConnectionsRevision: 0, openConnectionForm: vi.fn(), showAlert: vi.fn(), sidebarWidth: 260,
    activeView: null, sidebarVisible: true, editorTabs: {}, setEditorDirty: vi.fn((fn: (value: Record<string, boolean>) => Record<string, boolean>) => fn({})),
    previewTabId: null, keepTab: vi.fn(), handleResizeDragStart: vi.fn(), handleViewChange: vi.fn(),
    revealRequest: null, revealInWorkspace: vi.fn(), splitRatios: { main: .5, cross: .5 }, setSplitRatios: vi.fn(),
    persistRatios: vi.fn(), shellOptions: [{ id: 'powershell', label: 'PowerShell' }], handleSaveConnection: vi.fn(),
    showTab: vi.fn(), changeLayoutMode: vi.fn(), swapPanes: vi.fn(), handleConnect: vi.fn(), requestNewSession: vi.fn(),
    scriptRuns: { run: vi.fn() }, openEditor: vi.fn(), closeTabs: vi.fn(), closeTab: vi.fn(),
    disconnectSession: vi.fn(), reconnectSession: vi.fn(), activeSshId: null, activeSshName: null,
    isOverlayOpen: false, detachControl: { stateOf: vi.fn(() => null), toggle: vi.fn() },
    renderPaneHeader: vi.fn((i: number, conn?: Connection) => <div data-testid={`pane-header-${i}`}>{conn?.name ?? 'empty'}</div>),
    idleArtUrl: null, loadingArtUrl: null,
  }
  return { ...base, ...overrides } as MainLayoutModel
}

beforeEach(() => {
  mockOmnitermAPI({ settings: { save: vi.fn() }, terminalWindow: { focus: vi.fn() } })
})

describe('MainLayoutView coverage', () => {
  it('drives activity, workspace, files, fallback panel, and waiting actions', () => {
    const first = model({ activeView: 'workspace' })
    const { rerender } = render(<MainLayoutView model={first} />)
    fireEvent.click(screen.getByText('view'))
    fireEvent.click(screen.getByText('settings'))
    fireEvent.click(screen.getByText('open-script'))
    fireEvent.click(screen.getByText('run-script'))
    fireEvent.click(screen.getByText('add-conn'))
    fireEvent.click(screen.getByText('edit-conn'))
    fireEvent.mouseDown(document.querySelector('.cursor-col-resize') as Element)
    fireEvent.click(screen.getByText('new-wait'))
    fireEvent.click(screen.getByText('shell-wait'))
    expect(first.handleViewChange).toHaveBeenCalledWith('workspace')
    expect(first.setSettingsOpen).toHaveBeenCalledWith(true)
    expect(first.openEditor).toHaveBeenCalled()
    expect(first.scriptRuns.run).toHaveBeenCalled()
    expect(first.openConnectionForm).toHaveBeenCalledTimes(2)
    expect(first.handleResizeDragStart).toHaveBeenCalled()
    expect(first.requestNewSession).toHaveBeenCalled()
    expect(first.setShellMenu).toHaveBeenCalledWith({ x: 4, y: 9 })

    rerender(<MainLayoutView model={model({ activeView: 'files', activeSshId: 'ssh', activeSshName: 'SSH' })} />)
    expect(screen.getByTestId('files')).toHaveTextContent('ssh:SSH:true')
    rerender(<MainLayoutView model={model({ activeView: 'files', activeSshId: null })} />)
    expect(screen.getByTestId('workspace')).toBeInTheDocument()
  })

  it('handles the tab strip and all layout-picker transitions', () => {
    const m = model({
      activeTabs: [{ id: 'game-tab', connId: 'local', name: 'Game' }],
      panes: ['game-tab'],
      connById: (id?: string) => id === 'local'
        ? { ...local, localCommand: 'game.exe', localKeepOpen: false }
        : [ssh, rdp].find(c => c.id === id),
    })
    const { rerender } = render(<MainLayoutView model={m} />)
    for (const label of ['select-tab', 'promote-tab', 'close-tab', 'new-tab', 'shell-tab', 'reveal-tab']) fireEvent.click(screen.getByText(label))
    fireEvent.contextMenu(screen.getByText('menu-tab'), { clientX: 8, clientY: 9 })
    fireEvent.click(screen.getByTitle('Split 2'))
    expect(m.showTab).toHaveBeenCalledWith('game-tab')
    expect(m.keepTab).toHaveBeenCalledWith('game-tab')
    expect(m.closeTab).toHaveBeenCalledWith('game-tab')
    expect(m.setTabMenu).toHaveBeenCalledWith({ x: 8, y: 9, tabId: 'game-tab' })
    expect(m.changeLayoutMode).toHaveBeenCalledWith(2)
    expect(screen.getByTitle('New Terminal (Ctrl+N)')).toBeInTheDocument()
    expect(screen.getByTitle('New Terminal (Ctrl+N)')).not.toBeDisabled()

    const split2 = model({ layoutMode: 2, appSettings: { ...m.appSettings, split2Style: 'columns' }, activeTabs: [], panes: [null, null] })
    rerender(<MainLayoutView model={split2} />)
    fireEvent.click(screen.getByTitle(/Split 2 \(columns\)/))
    expect(split2.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ split2Style: 'rows' }))

    const split3 = model({ layoutMode: 3, appSettings: { ...m.appSettings, split3Style: 'right' }, activeTabs: [], panes: [null, null, null] })
    rerender(<MainLayoutView model={split3} />)
    fireEvent.click(screen.getByTitle(/Split 3 \(right\)/))
    expect(split3.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ split3Style: 'top' }))

    const single = model({
      activeTabs: [{ id: 'local-tab', connId: 'local', name: 'Local' }],
      panes: ['local-tab'],
      activeTabId: 'local-tab',
      detachControl: { stateOf: vi.fn(() => 'detach'), toggle: vi.fn() },
    })
    rerender(<MainLayoutView model={single} />)
    fireEvent.click(screen.getByText('toggle-detach'))
    expect(single.detachControl.toggle).toHaveBeenCalledWith('local-tab')
  })

  it('renders active footer variants and invokes every footer action', () => {
    const m = model({
      activeTabs: [{ id: 'ssh-tab', connId: 'ssh', name: 'SSH' }], panes: ['ssh-tab', null], layoutMode: 2,
      activeTabId: 'ssh-tab', focusedPane: 0, statuses: { 'ssh-tab': 'error' }, metrics: { 'ssh-tab': { latency: 12 } },
      detachControl: { stateOf: vi.fn(() => 'detach'), toggle: vi.fn() },
      resolveAppearance: vi.fn(() => ({ fontSize: 19 })),
    })
    const { rerender } = render(<MainLayoutView model={m} />)
    const footer = document.querySelector('.order-last') as HTMLElement
    expect(within(footer).getByText('SSH')).toBeInTheDocument()
    expect(screen.getByTestId('metrics')).toHaveTextContent('error:12:true')
    fireEvent.click(screen.getByText('Reconnect'))
    fireEvent.click(screen.getByTitle('Reset zoom to 100%'))
    expect(m.reconnectSession).toHaveBeenCalledWith('ssh-tab')
    expect(m.onZoomReset).toHaveBeenCalled()

    const connected = model({ activeTabs: [{ id: 'rdp-tab', connId: 'rdp', name: 'RDP' }], panes: ['rdp-tab'], activeTabId: 'rdp-tab', statuses: { 'rdp-tab': 'connected' }, latencies: { 'rdp-tab': 44 }, detachControl: { stateOf: vi.fn(() => 'detach'), toggle: vi.fn() } })
    rerender(<MainLayoutView model={connected} />)
    expect(screen.getByTestId('metrics')).toHaveTextContent('connected:44:false')
    fireEvent.click(screen.getByText('Disconnect'))
    fireEvent.click(screen.getByText('toggle-detach'))
    expect(connected.disconnectSession).toHaveBeenCalledWith('rdp-tab')
    expect(connected.detachControl.toggle).toHaveBeenCalledWith('rdp-tab')

    const localModel = model({ activeTabs: [{ id: 'local-tab', connId: 'local', name: 'Local' }], panes: ['local-tab'], activeTabId: 'local-tab', statuses: { 'local-tab': 'connected' }, activity: { 'local-tab': true }, onFontSizeChange: undefined, zoomFactor: undefined })
    rerender(<MainLayoutView model={localModel} />)
    expect(screen.getByText('PowerShell')).toBeInTheDocument()
    expect(screen.queryByTitle('Increase font size')).not.toBeInTheDocument()
    expect(screen.queryByText('Disconnect')).not.toBeInTheDocument()
  })

  it('covers empty split panes, drag/drop, resizers, and pane-specific actions', () => {
    const m = model({ layoutMode: 3, activeTabs: [{ id: 'local-tab', connId: 'local', name: 'Local' }], panes: ['local-tab', null, null], focusedPane: 1, dragPane: 0 })
    const { container } = render(<MainLayoutView model={m} />)
    const frame = screen.getByTestId('waiting-1').closest('.absolute') as HTMLElement
    fireEvent.dragOver(frame, { dataTransfer: { dropEffect: '' } })
    fireEvent.drop(frame, { dataTransfer: { getData: () => '0' } })
    fireEvent.mouseDown(screen.getByTestId('pane-header-1').parentElement as Element)
    fireEvent.click(screen.getAllByText('new-wait')[0])
    fireEvent.click(screen.getAllByText('shell-wait')[0])
    fireEvent.click(screen.getAllByText('choose-wait')[0])
    fireEvent.click(screen.getByText('resize-pane'))
    fireEvent.click(screen.getByText('commit-pane'))
    expect(m.swapPanes).toHaveBeenCalledWith(0, 1)
    expect(m.setDragPane).toHaveBeenCalledWith(null)
    expect(m.setFocusedPane).toHaveBeenCalledWith(1)
    expect(m.setPanePicker).toHaveBeenCalledWith(1)
    expect(m.setSplitRatios).toHaveBeenCalledWith({ main: .4, cross: .6 })
    expect(m.persistRatios).toHaveBeenCalled()
    expect(container.querySelector('.border-dashed')).toBeInTheDocument()
  })

  it('keeps the new-session and choose-session controls clickable around a launched pane', () => {
    const single = model({
      activeTabs: [{ id: 'game-tab', connId: 'local', name: 'Game' }],
      panes: ['game-tab'],
      activeTabId: 'game-tab',
      statuses: { 'game-tab': 'connected' },
      activity: { 'game-tab': true },
      connById: (id?: string) => id === 'local'
        ? { ...local, localCommand: 'game.exe', localKeepOpen: false }
        : undefined,
    })
    const { rerender } = render(<MainLayoutView model={single} />)
    fireEvent.click(screen.getByTitle('New Terminal (Ctrl+N)'))
    expect(single.requestNewSession).toHaveBeenCalled()

    const split = model({
      layoutMode: 2,
      activeTabs: [{ id: 'game-tab', connId: 'local', name: 'Game' }],
      panes: ['game-tab', null],
      focusedPane: 0,
      statuses: { 'game-tab': 'connected' },
      activity: { 'game-tab': true },
      connById: (id?: string) => id === 'local'
        ? { ...local, localCommand: 'game.exe', localKeepOpen: false }
        : undefined,
    })
    rerender(<MainLayoutView model={split} />)
    const choose = screen.getByText('choose-wait')
    fireEvent.click(choose)
    expect(split.setPanePicker).toHaveBeenCalledWith(1)
    expect(screen.getByTestId('waiting-1').closest('.absolute')).toHaveClass('z-10')
  })

  it('covers editor, RDP, detached, terminal, hidden, and connecting session variants', () => {
    const editor = { workspaceId: 'w', script: { path: '/a.ts', name: 'a.ts', kind: 'file' } }
    const m = model({
      layoutMode: 4,
      activeTabs: [
        { id: 'edit-tab', connId: 'file', name: 'Editor' },
        { id: 'rdp-tab', connId: 'rdp', name: 'RDP' },
        { id: 'pop-tab', connId: 'ssh', name: 'Popped' },
        { id: 'local-tab', connId: 'local', name: 'Local' },
        { id: 'hidden-tab', connId: 'ssh', name: 'Hidden' },
      ],
      panes: ['edit-tab', 'rdp-tab', 'pop-tab', 'local-tab'], focusedPane: 0,
      editorTabs: { 'edit-tab': editor }, poppedOut: { 'pop-tab': true }, resumeMode: { 'local-tab': true },
      statuses: { 'rdp-tab': 'connecting', 'local-tab': 'connecting' }, reconnectKeys: { 'rdp-tab': 1, 'local-tab': 2 },
      dragPane: 2, isOverlayOpen: true,
      connById: (id?: string) => (id === 'local' ? { ...local, localKeepOpen: false } : [local, ssh, rdp].find(c => c.id === id)),
    })
    const { container } = render(<MainLayoutView model={m} />)
    fireEvent.click(screen.getByText('run-editor'))
    fireEvent.click(screen.getByText('close-editor'))
    fireEvent.click(screen.getByText('dirty-editor'))
    fireEvent.click(screen.getByText('clean-editor'))
    fireEvent.click(screen.getByText('rdp-status'))
    fireEvent.click(screen.getByText('rdp-latency'))
    fireEvent.click(screen.getByText('focus-detached'))
    fireEvent.click(screen.getByText('reattach-detached'))
    const localTerminal = screen.getByTestId('terminal-local-tab')
    fireEvent.click(within(localTerminal).getByText('terminal-status'))
    fireEvent.click(within(localTerminal).getByText('terminal-metrics'))
    fireEvent.click(within(localTerminal).getByText('terminal-busy'))
    fireEvent.click(within(localTerminal).getByText('terminal-font'))
    fireEvent.click(within(localTerminal).getByText('terminal-exit'))
    expect(localTerminal).toHaveAttribute('data-mode', 'attach')
    expect(screen.getAllByTestId('connecting')).toHaveLength(2)
    expect(m.scriptRuns.run).toHaveBeenCalled()
    expect(m.keepTab).toHaveBeenCalledWith('edit-tab')
    expect(m.closeTab).toHaveBeenCalledWith('edit-tab')
    expect(m.setStatus).toHaveBeenCalledWith('rdp-tab', 'connected')
    expect(m.setLatency).toHaveBeenCalledWith('rdp-tab', 33)
    expect(m.reattachTerminal).toHaveBeenCalledWith('pop-tab')
    expect(m.setMetric).toHaveBeenCalledWith('local-tab', { latency: 7 })
    expect(m.setBusy).toHaveBeenCalledWith('local-tab', true)
    expect(m.onFontSizeChange).toHaveBeenCalled()
    expect(m.closeTabs).toHaveBeenCalledWith(['local-tab'], true)
    // Off-screen sessions keep their layout box (`.pane-offscreen`, not `display: none`) so xterm
    // holds on to its scroll position and cell grid across a tab switch — see index.css.
    expect(container.querySelector('.pane-offscreen')).toBeInTheDocument()
    expect(container.querySelector('.hidden')).not.toBeInTheDocument()
  })

  it('opens, saves, and closes the workspace connection form', () => {
    const ref = { current: 'workspace-1' }
    const m = model({ connFormOpen: true, connFormTarget: { folders: [], rootLabel: 'Workspace', parentPath: 'ops' }, connFormInitial: ssh, wsConnFormRef: ref })
    render(<MainLayoutView model={m} />)
    fireEvent.click(screen.getByText('save-form'))
    fireEvent.click(screen.getByText('close-form'))
    expect(m.handleSaveConnection).toHaveBeenCalledWith({ id: 'saved' })
    expect(m.setConnFormOpen).toHaveBeenCalledWith(false)
    expect(ref.current).toBeNull()
    expect(screen.getByTestId('overlays')).toBeInTheDocument()
  })
})

describe('pane drag-and-drop reordering', () => {
  /** jsdom has no DataTransfer, and fireEvent.drop will not synthesise one. */
  const drop = (target: Element, payload: string) =>
    fireEvent.drop(target, { dataTransfer: { getData: () => payload } })

  const split = (overrides: Record<string, unknown> = {}) => model({
    layoutMode: 2,
    panes: ['t1', null],
    activeTabs: [{ id: 't1', connId: 'local', name: 'Local' }],
    ...overrides,
  })

  it('swaps a session into the empty pane it was dropped on', () => {
    const swapPanes = vi.fn()
    render(<MainLayoutView model={split({ swapPanes, dragPane: 0 })} />)

    // Pane 1 is the empty frame; the payload is the index the header drag wrote.
    drop(screen.getByTestId('waiting-1').closest('[style]') as Element, '0')
    expect(swapPanes).toHaveBeenCalledWith(0, 1)
  })

  it('swaps two occupied panes', () => {
    const swapPanes = vi.fn()
    render(<MainLayoutView model={split({
      swapPanes,
      dragPane: 1,
      panes: ['t1', 't2'],
      activeTabs: [{ id: 't1', connId: 'local', name: 'Local' }, { id: 't2', connId: 'ssh', name: 'SSH' }],
    })} />)

    drop(screen.getByTestId('terminal-t1').closest('.absolute') as Element, '1')
    expect(swapPanes).toHaveBeenCalledWith(1, 0)
  })

  it('ignores a foreign drop instead of swapping pane 0 into it', () => {
    // `Number('')` is 0, so an unguarded parse turned a dropped file into "swap with pane 0".
    const swapPanes = vi.fn()
    const setDragPane = vi.fn()
    render(<MainLayoutView model={split({ swapPanes, setDragPane, dragPane: null })} />)

    const frame = screen.getByTestId('waiting-1').closest('[style]') as Element
    drop(frame, '')
    drop(frame, String.raw`C:\Users\me\notes.txt`)
    expect(swapPanes).not.toHaveBeenCalled()
    expect(setDragPane).toHaveBeenCalled()
  })

  it('marks the other panes as drop targets while a drag is in flight', () => {
    const { container } = render(<MainLayoutView model={split({ dragPane: 0 })} />)
    expect(container.querySelectorAll('.border-dashed').length).toBeGreaterThan(0)
  })
})
