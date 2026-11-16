import { useCallback, useEffect, useRef } from 'react'
import type { Connection, SessionStatus, WorkspaceScript } from '../domain'
import { useDetachControl } from '../hooks/useDetachControl'
import { editorTabId, useScriptRuns } from '../hooks/useScriptRuns'
import { isScriptFileOpen, openScriptFile, pairRunWithFile } from '../workbench/sessions/scriptRunLayout'
import { mintSessionId } from './mainLayoutShared'
import type { useMainLayoutBase } from './useMainLayoutBase'
import { sessionCloseNeedsConfirm } from '../workbench/sessions/sessionBusy'
import { closeSessionFromEvent } from '../workbench/sessions/sessionClose'
import { useSessionRecoveryState } from '../hooks/useSessionRecoveryState'

export function useMainLayoutSessions(base: ReturnType<typeof useMainLayoutBase>) {
  const { onActiveTerminalChange, layoutMode, setLayoutMode, activeTabs = [], setActiveTabs = () => {}, viewGroups = [], ephemeralConns = [], setEphemeralConns = () => {}, panes = [], setPanes = () => {}, focusedPane = 0, setFocusedPane = () => {}, activeTabId, setPendingCloseTabIds = () => {}, skipCloseConfirmRef, statuses = {}, setStatuses = () => {}, setReconnectKeys = () => {}, setLatencies = () => {}, detached = {}, setDetached = () => {}, poppedOut = {}, setPoppedOut = () => {}, setResumeMode = () => {}, setMetrics = () => {}, setConnectedAt = () => {}, setStatus = () => {}, setActivity = () => {}, activity = {}, connById = () => undefined, toggleDetach = () => {}, canDetachWindow = false, popOutTerminal = () => {}, reattachTerminal = () => {}, focusTerminal = () => {}, showAlert, showConfirm, dataMenuOpen = false, activeView, setActiveView = () => {}, editorTabs = {}, setEditorTabs = () => {}, editorDirty = {}, setEditorDirty = () => {}, previewTabId = null, setPreviewTabId = () => {}, handleConnectRef } = base

  const { clearPendingRestore, retryRestore, markRestoreReady, markRestoreFailed, restoreOutcomes } = useSessionRecoveryState({
    activeTabs,
    ephemeralConns,
    resolveConnection: connById,
    viewGroups,
    layoutMode,
    sessionCwds: base.sessionCwds,
    setActiveTabs,
    setEphemeralConns,
    setResumeMode,
    setPanes,
    setLayoutMode,
    setFocusedPane,
  })

  useEffect(() => {
      const tab = activeTabs.find(item => item.id === activeTabId);
      const conn = connById(tab?.connId);
      onActiveTerminalChange?.(tab && conn ? { id: tab.id, connId: tab.connId } : null);
  }, [activeTabId, activeTabs, connById, onActiveTerminalChange]);
  const showTab = (id: string, opts?: { autoFillOnly?: boolean; newTab?: boolean }) => {
      const visibleIdx = panes.findIndex((p, i) => p === id && i < layoutMode);
      if (visibleIdx !== -1) {
          setFocusedPane(visibleIdx);
          return;
      }
      const emptyIdx = panes.findIndex((p, i) => p === null && i < layoutMode);
      if (emptyIdx !== -1) {
          setPanes(prev => prev.map((p, i) => (i === emptyIdx ? id : (p === id ? null : p))));
          setFocusedPane(emptyIdx);
          return;
      }
      // No free pane: a new session takes the focused one. The session it replaces stays open as a tab.
      if (opts?.newTab) {
          setPanes(prev => prev.map((p, i) => (i === focusedPane ? id : (p === id ? null : p))));
          return;
      }
      if (opts?.autoFillOnly && layoutMode > 1) {
          setPanes(prev => prev.map(p => (p === id ? null : p)));
          return;
      }
      setPanes(prev => prev.map((p, i) => (i === focusedPane ? id : (p === id ? null : p))));
  };
  const removeFromPanes = (id: string, remaining: { id: string }[]) => {
      setPanes(prev => {
          const wasFocused = prev[focusedPane] === id;
          const next = prev.map(p => (p === id ? null : p));
          if (layoutMode === 1 && wasFocused) {
              const scoped = remaining;
              next[focusedPane] = scoped[scoped.length - 1]?.id ?? null;
          }
          return next;
      });
  };
  const handleConnect = (conn: Connection) => {
      setEphemeralConns(prev => (prev.some(e => e.id === conn.id) ? prev : [...prev, conn]));
      if (conn.type === 'LOCAL') {
          const sessionId = mintSessionId(conn);
          const instanceCount = activeTabs.filter(t => t.connId === conn.id).length;
          const name = instanceCount > 0 ? `${conn.name} (${instanceCount + 1})` : conn.name;
          setActiveTabs(prev => [...prev, { id: sessionId, connId: conn.id, name }]);
          showTab(sessionId, { autoFillOnly: true, newTab: true });
          return;
      }
      const alreadyOpen = !!activeTabs.find(t => t.connId === conn.id);
      if (!alreadyOpen) {
          setActiveTabs(prev => [...prev, { id: conn.id, connId: conn.id, name: conn.name }]);
      }
      showTab(conn.id, { autoFillOnly: !alreadyOpen, newTab: !alreadyOpen });
  };
  const scriptRuns = useScriptRuns({
      isEditorOpen: isScriptFileOpen,
      isTabOpen: (tabId) => activeTabs.some(t => t.id === tabId),
      pair: (terminalId, editorId) => { void pairRunWithFile(terminalId, editorId) },
      onError: (err) => void showAlert(err instanceof Error ? err.message : String(err), { title: 'Could not launch', tone: 'error' }),
  });
  /** Opens a script's file in the editor; a run of it that is still going is shown beside it. */
  const openEditor = (_workspaceId: string, script: WorkspaceScript) => {
      openScriptFile(script.path);
      scriptRuns.pairWithRun(script.path, editorTabId(script.path));
  };
  handleConnectRef.current = handleConnect;
  const noteShellOpenRef = useRef(scriptRuns.noteShellOpen);
  noteShellOpenRef.current = scriptRuns.noteShellOpen;
  useEffect(() => {
      const off = window.omnitermAPI.shells.onOpen(conn => {
          const c = conn as Connection;
          setEphemeralConns(prev => (prev.some(e => e.id === c.id) ? prev : [...prev, c]));
          handleConnectRef.current(c);
          noteShellOpenRef.current(c.id, !!c.localCommand);
      });
      window.omnitermAPI.shells.ready();
      return off;
  }, []);
  const disconnectByType = useCallback((sessionId: string, connId: string) => {
      const conn = connById(connId);
      if (conn?.type === 'RDP') {
          window.omnitermAPI.connect.rdpDisconnect(sessionId);
      }
      else if (conn?.type === 'LOCAL') {
          window.omnitermAPI.connect.localDisconnect(sessionId);
      }
      else {
          window.omnitermAPI.connect.sshDisconnect(sessionId);
      }
  }, [connById]);
  const clearTabState = (sessionIds: string[]) => {
      if (sessionIds.length === 0)
          return;
      const idSet = new Set(sessionIds);
      clearPendingRestore(sessionIds)
      const prune = <T,>(prev: Record<string, T>): Record<string, T> => {
          let changed = false;
          const next = { ...prev };
          for (const id of idSet) {
              if (id in next) {
                  delete next[id];
                  changed = true;
              }
          }
          return changed ? next : prev;
      };
      setStatuses(prune);
      setActivity(prune);
      setLatencies(prune);
      setDetached(prune);
      setPoppedOut(prune);
      setResumeMode(prune);
      setMetrics(prune);
      setConnectedAt(prune);
  };
  const closeTabs = (sessionIds: string[], skipConfirm = false, sessionAlreadyClosed = false) => {
      if (sessionIds.length === 0)
          return;
      if (!skipConfirm && !skipCloseConfirmRef.current) {
          const needsConfirm = sessionIds.some(id => {
              if (editorTabs[id])
                  return false;
              const conn = connById(activeTabs.find(t => t.id === id)?.connId);
              return sessionCloseNeedsConfirm(statuses[id], conn?.type, activity[id]);
          });
          if (needsConfirm) {
              setPendingCloseTabIds(sessionIds);
              return;
          }
      }
      const idSet = new Set(sessionIds);
      const closing = activeTabs.filter(t => idSet.has(t.id));
      const remaining = activeTabs.filter(t => !idSet.has(t.id));
      setActiveTabs(remaining);
      if (previewTabId && idSet.has(previewTabId))
          setPreviewTabId(null);
      for (const t of closing) {
          removeFromPanes(t.id, remaining);
          if (poppedOut[t.id] && !sessionAlreadyClosed && window.omnitermAPI.terminalWindow)
              window.omnitermAPI.terminalWindow.release(t.id);
          if (editorTabs[t.id]) {
              setEditorTabs(prev => { const n = { ...prev }; delete n[t.id]; return n; });
              setEditorDirty(prev => { const n = { ...prev }; delete n[t.id]; return n; });
          }
          else if (!sessionAlreadyClosed)
              disconnectByType(t.id, t.connId);
      }
      clearTabState(sessionIds);
      const goneConnIds = new Set(closing.map(t => t.connId).filter(cid => !remaining.some(t => t.connId === cid)));
      const releasing = ephemeralConns.filter(e => goneConnIds.has(e.id));
      if (releasing.length) {
          setEphemeralConns(prev => prev.filter(e => !goneConnIds.has(e.id)));
          for (const e of releasing)
              window.omnitermAPI.shells.release(e.id);
      }
  };
  useEffect(() => {
      if (!window.omnitermAPI.terminalWindow)
          return;
      return window.omnitermAPI.terminalWindow.onClosed((id) => {
          closeTabs([id], true, true);
      });
  }, [closeTabs]);
  useEffect(() => {
      if (typeof window.omnitermAPI.terminalWindow?.onContext !== 'function')
          return;
      return window.omnitermAPI.terminalWindow.onContext(({ sessionId, cwd, title }) => {
          if (cwd) base.setSessionCwd(sessionId, cwd);
          if (title) setActiveTabs(prev => prev.map(tab => tab.id === sessionId ? { ...tab, name: title } : tab));
      });
  }, [base.setSessionCwd, setActiveTabs]);
  const closeTab = (sessionId: string) => {
      if (editorTabs[sessionId] && editorDirty[sessionId]) {
          void showConfirm('Discard unsaved changes?', {
              title: 'Unsaved Changes', confirmLabel: 'Discard', cancelLabel: 'Keep Editing', tone: 'warning',
          }).then(ok => { if (ok)
              closeTabs([sessionId]); });
          return;
      }
      closeTabs([sessionId]);
  };
  const disconnectSession = (sessionId: string) => {
      const tab = activeTabs.find(t => t.id === sessionId);
      disconnectByType(sessionId, tab?.connId ?? sessionId);
  };
  const reconnectSession = (id: string) => {
      setStatus(id, 'connecting');
      setResumeMode(prev => (prev[id] ? { ...prev, [id]: false } : prev));
      setReconnectKeys(prev => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  };
  const handleRestoreStatus = (id: string, status: SessionStatus) => {
      setStatus(id, status);
      if (status === 'connected') markRestoreReady(id);
      else if (status === 'error' || status === 'closed') markRestoreFailed(id);
  };
  const activeTab = activeTabs.find(t => t.id === activeTabId);
  const activeConn = activeTab && connById(activeTab.connId);
  const activeSshId = activeConn?.type === 'SSH' &&
      statuses[activeTabId ?? ''] === 'connected'
      ? activeTabId
      : null;
  const activeSshName = activeSshId ? activeConn?.name ?? '' : '';
  useEffect(() => {
      if (activeView === 'files' && !activeSshId) {
          setActiveView('workspace');
          localStorage.setItem('cc.activeView', 'workspace');
      }
  }, [activeView, activeSshId]);
  const STATUS_RANK: Record<SessionStatus, number> = { connected: 3, connecting: 2, error: 1, closed: 0 };
  const connStatuses: Record<string, SessionStatus> = {};
  for (const t of activeTabs) {
      const s = statuses[t.id] ?? 'connecting';
      const prev = connStatuses[t.connId];
      if (!prev || STATUS_RANK[s] > STATUS_RANK[prev])
          connStatuses[t.connId] = s;
  }
  const isOverlayOpen = dataMenuOpen;
  useEffect(() => {
      window.omnitermAPI.connect.rdpSetOverlay(isOverlayOpen);
  }, [isOverlayOpen]);
  useEffect(() => {
      if (!activeTabId || isOverlayOpen)
          return;
      focusTerminal(activeTabId);
  }, [activeTabId, isOverlayOpen]);
  useEffect(() => {
      // A terminal can name itself (double Ctrl+C); Ctrl+W carries no id and closes the active tab.
      // The tab closes through the editor, asking first when the session is busy.
      const handleCloseTabEvent = (event: Event) => {
          closeSessionFromEvent((event as CustomEvent<{ id?: string } | undefined>).detail?.id);
      };
      window.addEventListener('omniterm:close-tab', handleCloseTabEvent);
      return () => window.removeEventListener('omniterm:close-tab', handleCloseTabEvent);
  }, []);
  const detachControl = useDetachControl({
      tabs: activeTabs, connById, isEditorTab: (id) => !!editorTabs[id],
      statuses, rdpDetached: detached, poppedOut, canDetachWindow,
      onRdpToggle: toggleDetach, onPopOut: popOutTerminal, onAttach: reattachTerminal,
  });
  return { showTab, removeFromPanes, handleConnect, scriptRuns, openEditor, noteShellOpenRef, disconnectByType, clearTabState, closeTabs, closeTab, disconnectSession, reconnectSession, handleRestoreStatus, retryRestore, restoreOutcomes, activeSshId, activeSshName, STATUS_RANK, connStatuses, isOverlayOpen, detachControl }
}
