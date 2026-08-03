import { useCallback, useEffect, useRef } from 'react'
import type { Connection, SessionStatus, WorkspaceScript } from '@omniterm/contract'
import type { LayoutMode } from '../themes'
import PaneHeader from './PaneHeader'
import { useDetachControl } from '../hooks/useDetachControl'
import { editorTabId, useScriptRuns } from '../hooks/useScriptRuns'
import { mintSessionId } from './mainLayoutShared'
import type { useMainLayoutBase } from './useMainLayoutBase'

export function useMainLayoutSessions(base: ReturnType<typeof useMainLayoutBase>) {
  const { appSettings, setAppSettings, themes, resolveAppearance, onActiveTerminalChange, onFontSizeChange, onThemeApply, layoutMode, setLayoutMode, settingsOpen, activeTabs, setActiveTabs, ephemeralConns, setEphemeralConns, panes, setPanes, focusedPane, setFocusedPane, activeTabId, setPendingCloseTabIds, skipCloseConfirmRef, panePicker, setPanePicker, panePickerRef, dragPane, setDragPane, statuses, setStatuses, setReconnectKeys, setLatencies, detached, setDetached, poppedOut, setPoppedOut, setResumeMode, setMetrics, setConnectedAt, setStatus, setActivity, connById, toggleDetach, canDetachWindow, popOutTerminal, reattachTerminal, focusTerminal, connFormOpen, showAlert, showConfirm, dataMenuOpen, activeView, setActiveView, editorTabs, setEditorTabs, editorDirty, setEditorDirty, previewTabId, setPreviewTabId, handleConnectRef } = base
  useEffect(() => {
      const tab = activeTabs.find(item => item.id === activeTabId);
      const conn = connById(tab?.connId);
      onActiveTerminalChange?.(tab && conn ? { id: tab.id, connId: tab.connId } : null);
  }, [activeTabId, activeTabs, connById, onActiveTerminalChange]);
  const showTab = (id: string, opts?: {
      autoFillOnly?: boolean;
  }) => {
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
      if (opts?.autoFillOnly && layoutMode > 1) {
          setPanes(prev => prev.map(p => (p === id ? null : p)));
          return;
      }
      setPanes(prev => prev.map((p, i) => (i === focusedPane ? id : (p === id ? null : p))));
  };
  const removeFromPanes = (id: string, remaining: {
      id: string;
  }[]) => {
      setPanes(prev => {
          const wasFocused = prev[focusedPane] === id;
          const next = prev.map(p => (p === id ? null : p));
          if (layoutMode === 1 && wasFocused) {
              next[focusedPane] = remaining[remaining.length - 1]?.id ?? null;
          }
          return next;
      });
  };
  const changeLayoutMode = useCallback((n: LayoutMode) => {
      if (focusedPane >= n) {
          setPanes(prev => {
              const next = [...prev];
              const tmp = next[n - 1];
              next[n - 1] = next[focusedPane];
              next[focusedPane] = tmp;
              return next;
          });
          setFocusedPane(n - 1);
      }
      if (n > layoutMode) {
          setPanes(prev => {
              const next = [...prev];
              const activeIds = activeTabs.map(t => t.id);
              const emptyIndices = [];
              for (let i = 0; i < n; i++) {
                  if (!next[i])
                      emptyIndices.push(i);
              }
              if (emptyIndices.length > 0) {
                  const unassignedTabs = activeIds.filter(id => {
                      for (let i = 0; i < n; i++)
                          if (next[i] === id)
                              return false;
                      return true;
                  });
                  let tIdx = 0;
                  for (const i of emptyIndices) {
                      if (tIdx < unassignedTabs.length) {
                          next[i] = unassignedTabs[tIdx++];
                      }
                  }
              }
              return next;
          });
      }
      setLayoutMode(n);
      localStorage.setItem('cc.layoutMode', String(n));
  }, [focusedPane, layoutMode, setLayoutMode, activeTabs]);
  useEffect(() => {
      const handleLayoutChange = (e: Event) => {
          const mode = (e as CustomEvent).detail.mode as LayoutMode;
          changeLayoutMode(mode);
      };
      window.addEventListener('omniterm:change-layout', handleLayoutChange);
      return () => window.removeEventListener('omniterm:change-layout', handleLayoutChange);
  }, [changeLayoutMode]);
  const assignToPane = (paneIndex: number, id: string) => {
      setPanes(prev => prev.map((p, i) => (i === paneIndex ? id : (p === id ? null : p))));
      setFocusedPane(paneIndex);
      setPanePicker(null);
  };
  const clearPane = (paneIndex: number) => {
      setPanes(prev => prev.map((p, i) => (i === paneIndex ? null : p)));
      setPanePicker(null);
  };
  const swapPanes = (a: number, b: number) => {
      if (a === b || Number.isNaN(a) || Number.isNaN(b))
          return;
      setPanes(prev => {
          const next = [...prev];
          const tmp = next[a];
          next[a] = next[b];
          next[b] = tmp;
          return next;
      });
      setFocusedPane(b);
  };
  const handleConnect = (conn: Connection) => {
      setEphemeralConns(prev => (prev.some(e => e.id === conn.id) ? prev : [...prev, conn]));
      if (conn.type === 'LOCAL') {
          const sessionId = mintSessionId(conn);
          const instanceCount = activeTabs.filter(t => t.connId === conn.id).length;
          const name = instanceCount > 0 ? `${conn.name} (${instanceCount + 1})` : conn.name;
          setActiveTabs(prev => [...prev, { id: sessionId, connId: conn.id, name }]);
          showTab(sessionId, { autoFillOnly: true });
          return;
      }
      const alreadyOpen = !!activeTabs.find(t => t.connId === conn.id);
      if (!alreadyOpen) {
          setActiveTabs(prev => [...prev, { id: conn.id, connId: conn.id, name: conn.name }]);
      }
      showTab(conn.id, { autoFillOnly: !alreadyOpen });
  };
  const pairRunWithEditor = (terminalId: string, editorId: string) => {
      setPanes(prev => {
          const next = prev.map(p => (p === terminalId || p === editorId ? null : p));
          next[0] = terminalId;
          next[1] = editorId;
          return next;
      });
      setFocusedPane(0);
      if (appSettings.split2Style === 'rows') {
          setAppSettings({ ...appSettings, split2Style: 'columns' });
      }
      if (layoutMode < 2)
          changeLayoutMode(2);
  };
  const scriptRuns = useScriptRuns({
      isEditorOpen: (editorId) => !!editorTabs[editorId],
      isTabOpen: (tabId) => activeTabs.some(t => t.id === tabId),
      pair: pairRunWithEditor,
      onError: (err) => void showAlert(err instanceof Error ? err.message : String(err), { title: 'Could not launch', tone: 'error' }),
  });
  const openEditor = (workspaceId: string, script: WorkspaceScript) => {
      const id = editorTabId(script.path);
      const isNew = !activeTabs.some(t => t.id === id);
      const stale = previewTabId && previewTabId !== id ? previewTabId : null;
      const stalePane = stale ? panes.findIndex((p, i) => p === stale && i < layoutMode) : -1;
      if (stale)
          closeTabs([stale]);
      setEditorTabs(prev => ({ ...prev, [id]: { workspaceId, script } }));
      setActiveTabs(prev => (prev.some(t => t.id === id) ? prev : [...prev, { id, connId: id, name: script.name }]));
      if (isNew)
          setPreviewTabId(id);
      if (stalePane !== -1)
          assignToPane(stalePane, id);
      else
          showTab(id, { autoFillOnly: true });
      scriptRuns.pairWithRun(script.path, id);
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
  const closeTabs = (sessionIds: string[], skipConfirm = false) => {
      if (sessionIds.length === 0)
          return;
      if (!skipConfirm && !skipCloseConfirmRef.current) {
          const needsConfirm = sessionIds.some(id => {
              if (editorTabs[id])
                  return false;
              const s = statuses[id] || 'closed';
              return s === 'connected' || s === 'connecting';
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
          if (poppedOut[t.id] && window.omnitermAPI.terminalWindow)
              window.omnitermAPI.terminalWindow.release(t.id);
          if (editorTabs[t.id]) {
              setEditorTabs(prev => { const n = { ...prev }; delete n[t.id]; return n; });
              setEditorDirty(prev => { const n = { ...prev }; delete n[t.id]; return n; });
          }
          else
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
  const isOverlayOpen = connFormOpen || settingsOpen || dataMenuOpen || panePicker !== null || dragPane !== null;
  useEffect(() => {
      window.omnitermAPI.connect.rdpSetOverlay(isOverlayOpen);
  }, [isOverlayOpen]);
  useEffect(() => {
      if (!activeTabId || isOverlayOpen)
          return;
      focusTerminal(activeTabId);
  }, [activeTabId, isOverlayOpen]);
  useEffect(() => {
      if (panePicker === null)
          return;
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape')
          setPanePicker(null); };
      const onClick = (e: MouseEvent) => {
          if (panePickerRef.current && !panePickerRef.current.contains(e.target as Node))
              setPanePicker(null);
      };
      window.addEventListener('keydown', onKey);
      window.addEventListener('mousedown', onClick);
      return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
  }, [panePicker]);
  useEffect(() => {
      const handleCloseTabEvent = () => {
          const activeTabId = panes[focusedPane];
          if (activeTabId) {
              setTimeout(() => closeTab(activeTabId), 0);
          }
      };
      window.addEventListener('omniterm:close-tab', handleCloseTabEvent);
      return () => window.removeEventListener('omniterm:close-tab', handleCloseTabEvent);
  }, [panes, focusedPane, closeTab]);
  const detachControl = useDetachControl({
      tabs: activeTabs, connById, isEditorTab: (id) => !!editorTabs[id],
      statuses, rdpDetached: detached, poppedOut, canDetachWindow,
      onRdpToggle: toggleDetach, onPopOut: popOutTerminal, onAttach: reattachTerminal,
  });
  const renderPaneHeader = (paneIndex: number, conn: Connection | null) => {
      const sessionId = panes[paneIndex];
      const target = sessionId && conn ? { id: sessionId, connId: conn.id } : null;
      const resolved = target ? resolveAppearance?.(target.id, target.connId) : undefined;
      const appearance = target && onThemeApply && onFontSizeChange ? {
          themes,
          themeId: resolved?.themeId ?? appSettings.themeId,
          fontSize: resolved?.fontSize ?? appSettings.fontSize,
          darkMode: appSettings.darkMode,
          onThemeApply: (themeId: string) => onThemeApply(themeId, target),
          onFontSizeChange: (delta: number) => onFontSizeChange(delta, target),
      } : undefined;
      return <PaneHeader paneIndex={paneIndex} conn={conn} focused={paneIndex === focusedPane} sessionId={sessionId} tabs={activeTabs} panes={panes} layoutMode={layoutMode} statuses={statuses} connType={(connId) => connById(connId)?.type} pickerOpen={panePicker === paneIndex} pickerRef={panePickerRef} detach={detachControl.stateOf(sessionId)} onToggleDetach={() => detachControl.toggle(sessionId)} onFocus={() => setFocusedPane(paneIndex)} onDragStart={() => setDragPane(paneIndex)} onDragEnd={() => setDragPane(null)} onTogglePicker={() => setPanePicker(p => (p === paneIndex ? null : paneIndex))} onAssign={(tabId) => assignToPane(paneIndex, tabId)} onClear={() => clearPane(paneIndex)} appearance={appearance}/>;
  };
  return { showTab, removeFromPanes, changeLayoutMode, assignToPane, clearPane, swapPanes, handleConnect, pairRunWithEditor, scriptRuns, openEditor, noteShellOpenRef, disconnectByType, clearTabState, closeTabs, closeTab, disconnectSession, reconnectSession, activeSshId, activeSshName, STATUS_RANK, connStatuses, isOverlayOpen, detachControl, renderPaneHeader }
}
