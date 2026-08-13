import type React from 'react'
import type { SessionStatus } from '@omniterm/contract'
import ActivityBar from './ActivityBar'; import FileBrowser from './FileBrowser'; import WorkspacePanel from './WorkspacePanel'; import ScriptViewer from './ScriptViewer'
import TerminalView from './TerminalView'; import RDPView from './RDPView'; import ConnectingOverlay from './ConnectingOverlay'; import DetachedPlaceholder from './DetachedPlaceholder'
import ConnectionForm from './ConnectionForm'; import MetricsChips from './SessionMetricsChips'; import SessionTabs from './SessionTabs'; import WaitingPane from './WaitingPane'
import { PaneResizers } from './PaneResizers'
import { Columns2, LayoutGrid, Loader2, Monitor, PanelLeft, RotateCw, Square, Terminal, Unplug } from 'lucide-react'
import { activityLabel, STATUS_DOT, STATUS_LABEL, STATUS_TEXT } from '../tabVisuals'
import { paneIdentity } from '../paneIdentity'
import { draggedPaneIndex, paneRect } from '../paneLayout'
import { closesOnExit } from '../sessionExit'
import { resolveEnterModes } from '../utils/enterKeys'
import { shellLabel } from '../shellOptions'
import { workspaceForConnection } from '../utils/workspaceIdentity'
import { Grid6Icon, Grid8Icon } from './mainLayoutShared'
import MainLayoutOverlays from './MainLayoutOverlays'
import FullscreenRestoreControl from './FullscreenRestoreControl'
import MainLayoutWaitingPane from './MainLayoutWaitingPane'
import type { MainLayoutModel } from './useMainLayoutController'
import ViewGroupTabs from './ViewGroupTabs'
import BlurSettingsOverlay from './BlurSettingsOverlay'
import { useBlurPlugin } from '../hooks/useBlurPlugin'
import { notifyViewGroupReorder, notifyViewGroupUngroup, notifyViewGroupUpdate } from '../viewGroups'

export default function MainLayoutView({ model }: { model: MainLayoutModel }) {
  const { appSettings, setAppSettings, currentTheme, themes, zoomFactor, onZoomReset, resolveAppearance, onFontSizeChange, layoutMode, setSettingsOpen, hasConnectionProvider, connectionCapabilities, activeTabs, visibleTabs = activeTabs, setActiveTabs, tabGroups = {}, ephemeralConns, panes, focusedPane, setFocusedPane, activeTabId, setTabMenu, setShellMenu, setPanePicker, setPanePickerAnchor = () => {}, dragPane, setDragPane, statuses, reconnectKeys, latencies, poppedOut, resumeMode, metrics, connectedAt, setStatus, setLatency, setMetric, activity, setBusy, connById, reattachTerminal, connFormOpen, setConnFormOpen, connFormInitial, setConnFormInitial, connFormTarget, wsConnFormRef, wsConnectionsRevision, openConnectionForm, showAlert, sidebarWidth, activeView, sidebarVisible, editorTabs, setEditorDirty, previewTabId, keepTab, handleResizeDragStart, handleViewChange, revealRequest, revealInWorkspace, splitRatios, setSplitRatios, persistRatios, shellOptions, requestNewSession, handleSaveConnection, showTab, changeLayoutMode, swapPanes, handleConnect, scriptRuns, openEditor, closeTabs, closeTab, disconnectSession, reconnectSession, activeSshId, activeSshName, isOverlayOpen, detachControl, renderPaneHeader, idleArtUrl, loadingArtUrl, alwaysAwake: awakeState, setAlwaysAwakeOpen, alwaysAwakeAvailable, viewGroups = [], activeGroupId = '', switchViewGroup = () => {}, fullscreenPane = null, setFullscreenPane = () => {} } = model
  const alwaysAwake = awakeState ?? {
    enabled: false, mode: 'activeOnly' as const, expiresAtMs: 0,
    activeSessionCount: 0, keepingAwake: false, supported: true, error: null,
  }
  const { open: blurOpen, setOpen: setBlurOpen, available: blurAvailable } = useBlurPlugin()
  const blurValue = appSettings.blurInactiveWindow ?? 0
  const fullscreenTabId = fullscreenPane === null ? null : panes[fullscreenPane] ?? null
  const ungroupedTabCount = activeTabs.filter(tab => !tabGroups[tab.id]).length
  const selectedWorkspace = (model.workspaces ?? []).find(workspace => workspace.id === model.selectedWorkspaceId)
  const activeEditorWorkspace = activeTabId ? model.editorTabs[activeTabId]?.workspaceId : undefined
  const activeConnId = activeTabId ? activeTabs.find(tab => tab.id === activeTabId)?.connId : undefined
  const activeConnection = activeConnId ? connById(activeConnId) : undefined
  const footerWorkspace = (model.workspaces ?? []).find(workspace => workspace.id === activeEditorWorkspace) ?? (activeTabId ? workspaceForConnection(model.workspaces ?? [], activeConnection) : selectedWorkspace)
  const onPaneDrop = (event: React.DragEvent, target: number) => {
    const source = draggedPaneIndex(event.dataTransfer.getData('text/plain'), layoutMode)
    if (source !== null) swapPanes(source, target)
    setDragPane(null)
  }
  const waitingPane = <MainLayoutWaitingPane model={model} customArtUrl={idleArtUrl} />
    return (
      <div className="h-full w-full flex bg-theme-bg overflow-hidden">
        {/* ── Activity Bar (icon rail — always visible) ────────────────── */}
        <ActivityBar
          activeView={activeView}
          filesEnabled={!!activeSshId && connectionCapabilities?.sftp === true}
          onViewChange={handleViewChange}
          onSettingsClick={() => setSettingsOpen(true)}
          alwaysAwakeAvailable={alwaysAwakeAvailable}
          alwaysAwakeEnabled={alwaysAwake.enabled}
          alwaysAwakeKeepingAwake={alwaysAwake.keepingAwake}
          onAlwaysAwakeClick={() => setAlwaysAwakeOpen(true)}
          blurAvailable={blurAvailable}
          blurEnabled={(appSettings.blurEnabled ?? true) && blurValue > 0}
          onBlurClick={() => setBlurOpen(true)}
        />
        {/* ── Secondary Panel (Workspace/Connections/Files) ────────────────── */}
        {activeView !== null && (
          <div
            className="flex-shrink-0 flex flex-col border-r border-[var(--theme-border)] min-w-0 overflow-hidden relative"
            style={{ width: sidebarVisible ? sidebarWidth : 0 }}
          >
            {activeView === 'workspace' ? (
              <WorkspacePanel
                onOpenScript={openEditor}
                onRunScript={scriptRuns.run}
                showAlert={showAlert}
                onConnectWorkspaceConnection={(connection, workspaceId) => handleConnect({ ...connection, workspaceId })}
                hasConnectionProvider={hasConnectionProvider}
                onAddWorkspaceConnection={(target) => {
                  setConnFormInitial(undefined)
                  openConnectionForm(target)
                }}
                onEditWorkspaceConnection={(target, conn) => {
                  setConnFormInitial(conn)
                  openConnectionForm(target)
                }}
                connectionsRevision={wsConnectionsRevision}
                revealRequest={revealRequest}
                onWorkspaceAdded={model.refreshWorkspaces}
              />
            ) : activeView === 'files' && activeSshId && activeSshName ? (
              <FileBrowser key={activeSshId} id={activeSshId} connectionName={activeSshName} active={sidebarVisible} />
            ) : (
              <WorkspacePanel onOpenScript={openEditor} />
            )}
          </div>
        )}
        {/* ── Resize Handle ────────────────────────────────────────────────── */}
        {activeView !== null && sidebarVisible && (
          <div
            className="w-1.5 flex-shrink-0 cursor-col-resize hover:bg-[var(--theme-accent)] transition-colors active:bg-[var(--theme-accent)] z-10"
            onMouseDown={handleResizeDragStart}
          />
        )}
        {/* ── Main area ───────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Panel header — session tabs fill the full width, layout picker on the right.
              Keeping the tabs in this fixed header row (above the content area) means
              the embedded RDP desktop can never paint over them. */}
          <div className="relative z-30 flex flex-col border-b border-[var(--theme-border)] flex-shrink-0">
            {viewGroups.length > 0 && <ViewGroupTabs groups={viewGroups} activeGroupId={activeGroupId} totalTabCount={ungroupedTabCount} onSelect={id => { setFullscreenPane(null); switchViewGroup(id) }} onUpdate={notifyViewGroupUpdate} onReorder={notifyViewGroupReorder} onUngroup={notifyViewGroupUngroup} />}
            <div className="h-[40px] px-2.5 flex items-center gap-2">
            {/* Tab list — flex-1 so it fills all available space before the picker */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <SessionTabs
                tabs={visibleTabs} panes={panes} layoutMode={layoutMode} focusedPane={focusedPane}
                statuses={statuses} activity={activity}
                isEditor={(id) => !!editorTabs[id]}
                isPreview={(id) => previewTabId === id}
                isEphemeral={(connId) => ephemeralConns.some(e => e.id === connId)}
                connType={(connId) => connById(connId)?.type}
                onSelect={showTab}
                onPromote={keepTab}
                onClose={closeTab}
                onContextMenu={(e, id) => { e.preventDefault(); setTabMenu({ x: e.clientX, y: e.clientY, tabId: id }) }}
                onNewSession={() => requestNewSession(undefined, model.selectedWorkspaceId)}
                onPickShell={(rect) => setShellMenu({ x: rect.left, y: rect.bottom + 4 })}
                onPickPane={layoutMode > 1
                  ? (rect) => {
                      setPanePickerAnchor(rect)
                      setPanePicker(Math.min(focusedPane, layoutMode - 1))
                    }
                  : undefined}
                detachTabId={layoutMode === 1 ? activeTabId : null}
                detachAction={layoutMode === 1 && activeTabId ? detachControl.stateOf(activeTabId) : null}
                onToggleDetach={() => { if (activeTabId) detachControl.toggle(activeTabId) }}
                onReveal={revealInWorkspace}
              />
            </div>
  
            {/* Layout picker — pinned to the right edge, slightly larger for prominence */}
            <div className="ml-auto flex items-center rounded-lg border border-[var(--theme-border)] overflow-hidden bg-black/10 flex-shrink-0">
              {([
                [1, Square, 'Single view'],
                [2, Columns2, 'Split 2'],
                [3, PanelLeft, 'Split 3'],
                [4, LayoutGrid, 'Grid 4'],
                [6, Grid6Icon, 'Grid 6'],
                [8, Grid8Icon, 'Grid 8']
              ] as const).map(([m, Icon, label]) => {
                const disabled = m > 1 && activeGroupId === 'ungrouped' && visibleTabs.length === 0
                return (
                <button
                  key={m}
                  type="button"
                  disabled={disabled}
                  title={
                    disabled ? 'Cannot select multi-view when ungrouped with no open tabs'
                    : m === 3 && layoutMode === 3 ? `${label} (${appSettings.split3Style || 'left'}) - Click to cycle`
                    : m === 2 && layoutMode === 2 ? `${label} (${appSettings.split2Style || 'columns'}) - Click to toggle`
                    : label
                  }
                  onClick={() => {
                    if (disabled) return
                    if (m === 3 && layoutMode === 3) {
                      const currentStyle = appSettings.split3Style || 'left'
                      const nextStyle = currentStyle === 'left' ? 'right' : currentStyle === 'right' ? 'top' : 'left'
                      setAppSettings({ ...appSettings, split3Style: nextStyle })
                      window.omnitermAPI.settings.save({ split3Style: nextStyle })
                    } else if (m === 2 && layoutMode === 2) {
                      const nextStyle = (appSettings.split2Style || 'columns') === 'columns' ? 'rows' : 'columns'
                      setAppSettings({ ...appSettings, split2Style: nextStyle })
                      window.omnitermAPI.settings.save({ split2Style: nextStyle })
                    } else {
                      changeLayoutMode(m)
                    }
                  }}
                  className={`relative inline-flex items-center justify-center w-6 h-6 transition-colors ${
                    disabled ? 'opacity-20 cursor-not-allowed'
                    : `hover:bg-white/5 ${
                        layoutMode === m
                          ? 'bg-white/10 text-[var(--theme-accent)] font-bold'
                          : 'text-inherit opacity-50 hover:opacity-100'
                      }`
                  }`}
                >
                  <Icon className={`w-4 h-4 ${m === 2 && layoutMode === 2 && appSettings.split2Style === 'rows' ? 'rotate-90' : ''}`} />
                  {m === 3 && layoutMode === 3 && (
                    <RotateCw className="absolute -top-1 -right-1 w-2.5 h-2.5 text-theme-accent" />
                  )}
                  {m === 2 && layoutMode === 2 && (
                    <RotateCw className="absolute -top-1 -right-1 w-2.5 h-2.5 text-theme-accent" />
                  )}
                </button>
              )})}
            </div>
  
            </div>
          </div>
  
          {/* Active-session control bar — rendered as a FOOTER (order-last) so the
              embedded RDP desktop filling the content area can never cover the controls. */}
          {activeTabId && (() => {
            const conn = activeConnection
            if (!conn) {
              return (
                <div className="relative z-30 order-last min-h-7 flex-shrink-0 bg-theme-sidebar border-t border-theme-border flex items-center gap-2 px-2.5 text-[10px] text-theme-dim">
                  <span className="truncate" title={footerWorkspace?.path ?? 'No workspace selected'}>Workspace · {footerWorkspace?.name ?? 'No workspace'}</span>
                  <span className="opacity-60">·</span>
                  <span className="truncate">Editor active</span>
                  {typeof zoomFactor === 'number' && <span className="ml-auto font-mono">{Math.round(zoomFactor * 100)}%</span>}
                </div>
              )
            }
            const status = statuses[activeTabId] ?? 'connecting'
            const resolvedLatency = conn.type === 'RDP'
              ? (latencies[activeTabId] ?? null)
              : (metrics[activeTabId]?.latency ?? null)
            return (
              <div className="relative z-30 order-last h-7 flex-shrink-0 bg-theme-sidebar border-t border-theme-border flex items-center gap-2 px-2.5 select-none">
                {layoutMode > 1 && (() => {
                  const identity = paneIdentity(focusedPane)
                  const Shape = identity.icon
                  return (
                    <span className="flex items-center gap-1 flex-shrink-0" style={{ color: identity.color }}
                      title={`Pane ${focusedPane + 1} · ${identity.label}`}>
                      <Shape className="w-3.5 h-3.5" fill={identity.color} />
                      <span className="text-[9px] font-bold">{focusedPane + 1}</span>
                    </span>
                  )
                })()}
                <span className="max-w-[180px] truncate text-[10px] text-theme-dim" title={footerWorkspace?.path ?? 'No workspace selected'}>
                  Workspace · {footerWorkspace?.name ?? 'No workspace'}
                </span>
                <span className="opacity-50">·</span>
                {conn.type === 'RDP'
                  ? <Monitor className="w-3.5 h-3.5 text-theme-accent flex-shrink-0" />
                  : <Terminal className="w-3.5 h-3.5 text-theme-accent flex-shrink-0" />
                }
                <span className="text-xs font-medium text-[var(--theme-fg)] truncate min-w-0">{conn.name}</span>
  
                {/* Status pill — sits right after the name, with the shell's activity when we know it */}
                <span className={`inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0 rounded-full flex-shrink-0 ${STATUS_TEXT[status]} bg-theme-bg`}>
                  {status === 'connecting' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
                  )}
                  {STATUS_LABEL[status]}
                  {(() => {
                    const word = activityLabel({
                      status,
                      busy: conn.type === 'LOCAL' ? (activity[activeTabId] ?? false) : undefined,
                    })
                    return word ? <span className="font-normal text-theme-dim">· {word}</span> : null
                  })()}
                </span>
  
                {/* Live metrics: latency (SSH + RDP) + remote CPU/RAM/disk + uptime (SSH). */}
                <MetricsChips
                  status={status}
                  latency={resolvedLatency}
                  metrics={metrics[activeTabId]}
                  connectedAt={connectedAt[activeTabId]}
                  compact={layoutMode > 1}
                />
  
                {layoutMode === 1 && (
                  <span className="text-[10px] text-theme-dim truncate min-w-0 ml-auto shrink">
                    {conn.type === 'LOCAL'
                      ? shellLabel(shellOptions, conn.shell)
                      : `${conn.user}@${conn.host}:${conn.port}`}
                  </span>
                )}
  
                <div className={`flex items-center gap-1.5 ${layoutMode > 1 ? 'ml-auto' : ''}`}>
                  {status === 'closed' || status === 'error' ? (
                    <button
                      onClick={() => reconnectSession(activeTabId)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-theme-accent text-theme-accent-fg hover:bg-[#89ddff] transition-colors"
                    >
                      <RotateCw className="w-3 h-3" />
                      Reconnect
                    </button>
                  ) : (
                    conn.type !== 'LOCAL' && (
                      <button
                        onClick={() => disconnectSession(activeTabId)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border border-theme-border text-theme-fg hover:border-[#f7768e] hover:text-theme-error transition-colors"
                      >
                        <Unplug className="w-3 h-3" />
                        Disconnect
                      </button>
                    )
                  )}
                </div>
                {typeof zoomFactor === 'number' && (
                  <button
                    type="button"
                    onClick={onZoomReset}
                    title="Reset zoom to 100%"
                    className="flex-shrink-0 text-[10px] font-mono text-theme-dim hover:text-theme-accent transition-colors px-1"
                  >
                    {Math.round(zoomFactor * 100)}%
                  </button>
                )}
              </div>
            )
          })()}
          {!activeTabId && (
            <div className="relative z-30 order-last min-h-7 flex-shrink-0 bg-theme-sidebar border-t border-theme-border flex items-center gap-2 px-2.5 text-[10px] text-theme-dim">
              <span className="truncate" title={footerWorkspace?.path ?? 'No workspace selected'}>Workspace · {footerWorkspace?.name ?? 'No workspace'}</span>
              <span className="opacity-60">·</span>
              <span>No active terminal</span>
              {typeof zoomFactor === 'number' && <span className="ml-auto font-mono">{Math.round(zoomFactor * 100)}%</span>}
            </div>
          )}
          {/* Session content; hidden panes remain mounted to preserve terminal scroll state. */}
          <div className="flex-1 relative isolate min-h-0 mt-1">
            {fullscreenTabId && <FullscreenRestoreControl sessionName={activeTabs.find(tab => tab.id === fullscreenTabId)?.name} onRestore={() => setFullscreenPane(null)} />}
            {activeTabs.length === 0 ? (
              waitingPane
            ) : (
              <>
                {/* Keep sessions mounted while the group index catches up after a layout change. */}
                {visibleTabs.length === 0 && <div className="absolute inset-0 z-30">{waitingPane}</div>}
                {/* Empty-pane frames (split view only). Filled panes draw their own chrome in
                    the session wrapper below (so the header sits above the native RDP window).
                    Each frame is a drop target and hosts a quick-pick to fill the slot. */}
                {layoutMode > 1 && !fullscreenTabId && Array.from({ length: layoutMode }).map((_, i) => {
                  if (panes[i]) return null
                  const isFocused = i === focusedPane
                  const isDropTarget = dragPane !== null && dragPane !== i
                  return (
                    <div
                      key={`frame-${i}`}
                      className="absolute z-10 p-0.5"
                      style={paneRect(i, layoutMode, appSettings.split3Style, appSettings.split2Style, splitRatios)}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                      onDrop={(e) => { e.preventDefault(); onPaneDrop(e, i) }}
                    >
                      <div
                        onMouseDown={() => setFocusedPane(i)}
                        style={isFocused && !isDropTarget ? { borderColor: paneIdentity(i).color } : undefined}
                        className={`h-full w-full flex flex-col rounded-lg border ${
                          isDropTarget ? 'border-dashed border-theme-accent' : isFocused ? '' : 'border-theme-border'
                        }`}
                      >
                        {renderPaneHeader(i, null)}
                        {/* The idle pane shows the app's waiting page; both of its actions still
                            target THIS pane (the picker only opens from its own button). */}
                        <div className="flex-1 min-h-0">
                          <WaitingPane
                            dark={!!appSettings.darkMode}
                            compact
                            paneIndex={i}
                            openSessionCount={visibleTabs.length}
                            onNewSession={() => { setFocusedPane(i); requestNewSession(undefined, model.selectedWorkspaceId) }}
                            onPickShell={(rect) => { setFocusedPane(i); setShellMenu({ x: rect.left, y: rect.bottom + 4 }) }}
                            workspaces={model.workspaces ?? []} selectedWorkspaceId={model.selectedWorkspaceId ?? null} onWorkspaceChange={model.setSelectedWorkspaceId ?? (() => {})}
                            onChooseSession={(rect) => { setPanePickerAnchor(rect); setPanePicker(i) }}
                            customArtUrl={idleArtUrl}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
  
                {/* Draggable boundaries. Above the frames, below the pane content. */}
                {!fullscreenTabId && <PaneResizers mode={layoutMode} ratios={splitRatios}
                  split3Style={appSettings.split3Style ?? 'left'} split2Style={appSettings.split2Style ?? 'columns'}
                  onChange={setSplitRatios} onCommit={persistRatios} />}
  
                {/* Session views — one per open tab, positioned into its pane (or hidden). */}
                {activeTabs.map(tab => {
                  const conn = connById(tab.connId)
                  const appearance = resolveAppearance?.(tab.id, tab.connId) ?? {}
                  const terminalTheme = themes.find(theme => theme.id === (appearance.themeId ?? appSettings.themeId)) ?? currentTheme
                  const terminalFontSize = appearance.fontSize ?? appSettings.fontSize
                  const terminalTarget = { id: tab.id, connId: tab.connId }
                  const sourcePaneIdx = panes.findIndex((p, i) => p === tab.id && i < layoutMode)
                  const visible = fullscreenTabId ? tab.id === fullscreenTabId : sourcePaneIdx !== -1
                  const paneIdx = fullscreenTabId ? 0 : sourcePaneIdx
                  const split = !fullscreenTabId && visible && layoutMode > 1
                  const isFocused = sourcePaneIdx === focusedPane
                  const isDropTarget = split && dragPane !== null && dragPane !== paneIdx
                  const style: React.CSSProperties = fullscreenTabId && visible
                    ? { left: 0, top: 0, width: '100%', height: '100%' }
                    : visible && layoutMode > 1
                    ? paneRect(paneIdx, layoutMode, appSettings.split3Style, appSettings.split2Style, splitRatios)
                    : { left: 0, top: 0, width: '100%', height: '100%' }
                  const editor = editorTabs[tab.id]
                  const sessionView = editor ? (
                    <ScriptViewer workspaceId={editor.workspaceId} script={editor.script}
                      onClose={() => closeTab(tab.id)}
                      onRun={() => { keepTab(tab.id); scriptRuns.run(editor.workspaceId, editor.script) }}
                      onDirtyChange={(d) => {
                        // An edit is a commitment — a peeked file stops being disposable.
                        if (d) keepTab(tab.id)
                        setEditorDirty(prev => (prev[tab.id] === d ? prev : { ...prev, [tab.id]: d }))
                      }} />
                  ) : conn?.type === 'RDP' ? (
                    <RDPView
                      key={`${tab.id}:${reconnectKeys[tab.id] ?? 0}`}
                      id={tab.id}
                      connection={conn}
                      active={visible}
                      paneEpoch={`${fullscreenTabId ? 'fullscreen' : layoutMode}:${sourcePaneIdx}`}
                      overlayActive={isOverlayOpen}
                      onStatus={(s: SessionStatus) => setStatus(tab.id, s)}
                      onLatency={(ms: number | null) => setLatency(tab.id, ms)}
                    />
                  ) : poppedOut[tab.id] ? (
                    <DetachedPlaceholder
                      name={tab.name}
                      onFocus={() => window.omnitermAPI.terminalWindow.focus(tab.id)}
                      onReattach={() => reattachTerminal(tab.id)}
                    />
                  ) : (
                    <TerminalView
                      key={`${tab.id}:${reconnectKeys[tab.id] ?? 0}`} id={tab.id} connection={conn!}
                      mode={resumeMode[tab.id] ? 'attach' : 'connect'}
                      // A hidden pane keeps its layout box, so it can no longer infer this from its
                      // own size — it has to be told. Drives focus and the scroll-tail restore.
                      active={visible}
                      layoutEpoch={`${fullscreenTabId ? 'fullscreen' : layoutMode}:${sourcePaneIdx}`}
                      darkMode={appSettings.darkMode}
                      blurStrength={blurAvailable && (appSettings.blurEnabled ?? true) && appSettings.blurInactiveDock ? appSettings.blurInactiveWindow ?? 0 : 0}
                      onStatus={(s: SessionStatus) => setStatus(tab.id, s)}
                      onMetrics={(m) => setMetric(tab.id, m)}
                      onActivity={(busy) => setBusy(tab.id, busy)}
                      onTitleChange={(title) => {
                        const clean = title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)
                        if (clean) setActiveTabs(previous => previous.map(item => item.id === tab.id ? { ...item, name: clean } : item))
                      }}
                      // A run-to-completion pane has nothing left once its shell exits, so it takes its
                      // own tab with it (see sessionExit.ts). skipConfirm: the session is already gone.
                      onExit={(code) => { if (closesOnExit(conn, code)) closeTabs([tab.id], true) }}
                      theme={appSettings.darkMode ? terminalTheme.terminal.dark : terminalTheme.terminal.light}
                      fontSize={terminalFontSize} smartColors={appSettings.smartColors}
                      onFontSizeChange={onFontSizeChange
                        ? (size) => onFontSizeChange(size - terminalFontSize, terminalTarget)
                        : undefined}
                      shortcuts={appSettings.shortcuts}
                      enterModes={resolveEnterModes(appSettings)}
                      fontFamilyMono={appSettings.darkMode ? terminalTheme.ui.dark.fontFamilyMono : terminalTheme.ui.light.fontFamilyMono}
                    />
                  )
                  return (
                    <div
                      key={tab.id}
                      onMouseDownCapture={() => { if (visible && sourcePaneIdx >= 0) setFocusedPane(sourcePaneIdx) }}
                      onDragOver={split ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } : undefined}
                      onDrop={split ? (e) => { e.preventDefault(); onPaneDrop(e, paneIdx) } : undefined}
                      // `pane-offscreen`, not Tailwind's `hidden`: `display: none` destroys an
                      // xterm pane's scroll position and forces a re-fit on every tab switch — see the rule's own comment in index.css.
                      className={`absolute ${visible ? '' : 'pane-offscreen'} ${split ? 'p-0.5' : ''}`}
                      style={style}
                    >
                      <div
                        style={split && isFocused && !isDropTarget ? { borderColor: paneIdentity(paneIdx).color } : undefined}
                        className={`h-full w-full flex flex-col ${split ? `rounded-lg border ${
                          isDropTarget ? 'border-dashed border-theme-accent' : isFocused ? '' : 'border-theme-border'
                        }` : ''}`}
                      >
                        {split && renderPaneHeader(paneIdx, conn ?? null)}
                        <div className={`flex-1 min-h-0 relative ${split ? 'rounded-b-lg overflow-hidden' : ''}`}>
                          {sessionView}
                          {statuses[tab.id] === 'connecting' && !poppedOut[tab.id] && <ConnectingOverlay dark={appSettings.darkMode} customArtUrl={loadingArtUrl} />}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
        {/* ── Connection form modal ────────────────────────────────────────── */}
        {connFormOpen && connFormTarget && (
          <ConnectionForm
            folders={connFormTarget.folders}
            capabilities={connectionCapabilities}
            scopeLabel={connFormTarget.rootLabel}
            rootLabel={connFormTarget.rootLabel}
            initial={connFormInitial}
            defaultParentId={connFormTarget.parentPath || undefined}
            onClose={() => { setConnFormOpen(false); wsConnFormRef.current = null }}
            onSave={handleSaveConnection}
          />
        )}
        <MainLayoutOverlays model={model} />
        {blurOpen && blurAvailable && <BlurSettingsOverlay strength={appSettings.blurInactiveWindow ?? 0} blurDock={appSettings.blurInactiveDock ?? false} enabled={appSettings.blurEnabled ?? true} onSave={(blurInactiveWindow, blurInactiveDock, blurEnabled) => { const next = { ...appSettings, blurInactiveWindow, blurInactiveDock, blurEnabled }; setAppSettings(next); window.omnitermAPI.settings.save(next) }} onClose={() => setBlurOpen(false)} />}
    </div>)
}
