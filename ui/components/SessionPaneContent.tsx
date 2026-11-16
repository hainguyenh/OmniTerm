import type { SessionStatus } from '../domain'

import { QuotaPaneLines, SuspendedOverlay, UsageProbeOverlay } from '../features/agent-quota/paneHosts'
import { isRenewing } from '../hooks/useRenewSession'
import { closesOnExit } from '../sessionExit'
import { recentlyInterrupted } from '../terminal/ctrlCGuard'
import { resolveEnterModes } from '../utils/enterKeys'
import { zoomedFontSize } from '../utils/paneZoom'
import { showSessionTab } from '../workbench/sessions/sessionTabActions'

import ConnectingOverlay from './ConnectingOverlay'
import DetachedPlaceholder from './DetachedPlaceholder'
import { PaneSessionOverlayHost } from './PaneSessionOverlayHost'
import RDPView from './RDPView'
import SessionUnavailableOverlay from './SessionUnavailableOverlay'
import TerminalView from './TerminalView'
import type { MainLayoutModel } from './useMainLayoutController'

interface SessionPaneContentProps {
  model: MainLayoutModel
  tab: { id: string; connId: string; name: string }
  /** The terminal is the one the user sees: it takes focus and restores its scroll tail. */
  active: boolean
  /** Changes whenever the terminal's box moved or resized by layout; it then refits. */
  layoutEpoch: string
  /** Multiplier applied to the font size (the grid's zoom). */
  zoom: number
  roundedBottom?: boolean
  onNewSession: () => void
}

/**
 * The terminal (or RDP view) of one session with the overlays that belong to it. Shared by the
 * pane grid and by the session editor tabs, which render it through a portal into the session's
 * surface (see workbench/sessions).
 */
export function SessionPaneContent({ model, tab, active, layoutEpoch, zoom, roundedBottom, onNewSession }: SessionPaneContentProps) {
  const {
    appSettings, currentTheme, themes, resolveAppearance, onFontSizeChange, connById, reconnectKeys, statuses,
    poppedOut, resumeMode, restoreOutcomes = {}, retryRestore = () => {}, isOverlayOpen, setLatency, setMetric,
    setBusy, setActiveTabs, setSessionCwd, closeTabs, reconnectSession, reattachTerminal, focusedPane,
    requestNewSession, selectedWorkspaceId, loadingArtUrl,
  } = model
  const handleRestoreStatus = model.handleRestoreStatus ?? model.setStatus
  const conn = connById(tab.connId)
  const appearance = resolveAppearance?.(tab.id, tab.connId) ?? {}
  const terminalTheme = themes.find(theme => theme.id === (appearance.themeId ?? appSettings.themeId)) ?? currentTheme
  const terminalFontSize = zoomedFontSize(appearance.fontSize ?? appSettings.fontSize, zoom)
  const terminalTarget = { id: tab.id, connId: tab.connId }
  const restoreOutcome = restoreOutcomes[tab.id]
  const restoreBlocked = restoreOutcome?.phase === 'pending' || restoreOutcome?.phase === 'failed'
  const sessionView = restoreBlocked ? (
    <SessionUnavailableOverlay
      message={restoreOutcome.message}
      onRestart={restoreOutcome.retryable && restoreOutcome.phase !== 'pending'
        ? () => retryRestore(tab.id)
        : undefined}
      actionLabel="Restart terminal"
    />
  ) : !conn ? (
    // The saved connection was deleted (or has not loaded yet): a terminal cannot start without it.
    <SessionUnavailableOverlay message="This session's connection no longer exists." />
  ) : conn.type === 'RDP' ? (
    <RDPView
      key={`${tab.id}:${reconnectKeys[tab.id] ?? 0}`}
      id={tab.id}
      connection={conn}
      active={active}
      paneEpoch={layoutEpoch}
      overlayActive={isOverlayOpen}
      onStatus={(status: SessionStatus) => handleRestoreStatus(tab.id, status)}
      onLatency={(ms: number | null) => setLatency(tab.id, ms)}
    />
  ) : poppedOut[tab.id] ? (
    <DetachedPlaceholder
      name={tab.name}
      onFocus={() => window.omnitermAPI.terminalWindow.focus(tab.id)}
      // Capture the CURRENT focused slot at click time — never the pane the tab
      // used to live in before it was popped out.
      onReattach={() => {
        reattachTerminal(tab.id, focusedPane)
        // A session tab stays where it is while detached: coming back focuses it.
        showSessionTab(tab.id)
      }}
    />
  ) : (
    <TerminalView
      key={`${tab.id}:${reconnectKeys[tab.id] ?? 0}`} id={tab.id} connection={conn}
      mode={resumeMode[tab.id] ? 'attach' : 'connect'}
      onRestart={() => reconnectSession(tab.id)}
      // A hidden pane keeps its layout box, so it can no longer infer this from its
      // own size — it has to be told. Drives focus and the scroll-tail restore.
      active={active}
      layoutEpoch={layoutEpoch}
      darkMode={appSettings.darkMode}
      // The process a renew replaces ends on purpose; its closed/error is not the pane's state.
      onStatus={(status: SessionStatus) => { if (!(isRenewing(tab.id) && (status === 'closed' || status === 'error'))) handleRestoreStatus(tab.id, status) }}
      onMetrics={(m) => setMetric(tab.id, m)}
      onActivity={(busy) => setBusy(tab.id, busy)}
      onTitleChange={(title) => {
        const clean = title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)
        if (clean) setActiveTabs(previous => previous.map(item => item.id === tab.id ? { ...item, name: clean } : item))
      }}
      onCwdChange={(cwd) => setSessionCwd(tab.id, cwd)}
      // A run-to-completion pane has nothing left once its shell exits, so it takes its
      // own tab with it (see sessionExit.ts). skipConfirm: the session is already gone.
      // Renew kills this process on purpose; that exit must not close the tab.
      onExit={(code) => { if (!isRenewing(tab.id) && closesOnExit(conn, code, recentlyInterrupted(tab.id, Date.now()))) closeTabs([tab.id], true) }}
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
    <>
      <QuotaPaneLines sessionId={tab.id} />
      <div className={`flex-1 min-h-0 relative ${roundedBottom ? 'rounded-b-lg ' : ''}overflow-hidden`}>
        {sessionView}
        <SuspendedOverlay sessionId={tab.id} />
        <UsageProbeOverlay sessionId={tab.id} />
        <PaneSessionOverlayHost
          sessionId={tab.id}
          onResumeCommand={(command, cwd) => requestNewSession(undefined, selectedWorkspaceId, cwd ?? null, command)}
          onNewSession={onNewSession}
        />
        {statuses[tab.id] === 'connecting' && !poppedOut[tab.id] && <ConnectingOverlay dark={appSettings.darkMode} customArtUrl={loadingArtUrl} />}
      </div>
    </>
  )
}
