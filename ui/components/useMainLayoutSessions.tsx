import { useCallback, useEffect, useRef } from 'react'
import type { Connection, SessionStatus, WorkspaceScript } from '@omniterm/contract'
import type { LayoutMode } from '../themes'
import PaneHeader from './PaneHeader'
import { useDetachControl } from '../hooks/useDetachControl'
import { editorTabId, useScriptRuns } from '../hooks/useScriptRuns'
import { mintSessionId } from './mainLayoutShared'
import type { useMainLayoutBase } from './useMainLayoutBase'
import { DEFAULT_VIEW_GROUP_ID } from '../viewGroups'
import { diag } from '../diag'
import { paneOrder } from '../paneLayout'
import { shellLabel as getShellLabel } from '../shellOptions'
import { useSessionPersistence } from '../hooks/useSessionPersistence'
import { useSessionRestore } from '../hooks/useSessionRestore'

export function useMainLayoutSessions(base: ReturnType<typeof useMainLayoutBase>) {
  const { appSettings, setAppSettings, themes, resolveAppearance, onActiveTerminalChange, onFontSizeChange, onThemeApply, layoutMode, setLayoutMode, settingsOpen, activeTabs = [], setActiveTabs = () => {}, tabGroups = {}, setTabGroups = () => {}, viewGroups = [], activeGroupId = DEFAULT_VIEW_GROUP_ID, switchViewGroup = () => {}, createNewViewGroup = () => DEFAULT_VIEW_GROUP_ID, restoreGroups = () => {}, ephemeralConns = [], setEphemeralConns = () => {}, panes = [], setPanes = () => {}, focusedPane = 0, setFocusedPane = () => {}, fullscreenPane = null, setFullscreenPane = () => {}, activeTabId, setPendingCloseTabIds = () => {}, skipCloseConfirmRef, panePicker = null, setPanePicker = () => {}, panePickerAnchor, setPanePickerAnchor = () => {}, panePickerRef, dragPane = null, setDragPane = () => {}, statuses = {}, setStatuses = () => {}, setReconnectKeys = () => {}, setLatencies = () => {}, detached = {}, setDetached = () => {}, poppedOut = {}, setPoppedOut = () => {}, setResumeMode = () => {}, setMetrics = () => {}, setConnectedAt = () => {}, setStatus = () => {}, setActivity = () => {}, activity = {}, connById = () => undefined, toggleDetach = () => {}, canDetachWindow = false, popOutTerminal = () => {}, reattachTerminal = () => {}, focusTerminal = () => {}, connFormOpen = false, showAlert, showConfirm, dataMenuOpen = false, activeView, setActiveView = () => {}, editorTabs = {}, setEditorTabs = () => {}, editorDirty = {}, setEditorDirty = () => {}, previewTabId = null, setPreviewTabId = () => {}, handleConnectRef, shellOptions } = base

  const { initialSnapshot } = useSessionPersistence({
    activeTabs,
    ephemeralConns,
    resolveConnection: connById,
    viewGroups,
    tabGroups,
    activeGroupId,
    layoutMode,
  })

  useSessionRestore({
    initialSnapshot,
    setActiveTabs,
    setEphemeralConns,
    setTabGroups,
    setResumeMode,
    resolveConnection: connById,
    restoreGroups,
    setPanes,
    setLayoutMode,
    setFocusedPane,
  })

  useEffect(() => {
      const tab = activeTabs.find(item => item.id === activeTabId);
      const conn = connById(tab?.connId);
      onActiveTerminalChange?.(tab && conn ? { id: tab.id, connId: tab.connId } : null);
  }, [activeTabId, activeTabs, connById, onActiveTerminalChange]);
  const setTabGroup = (id: string, groupId: string) => {
      setTabGroups(prev => {
          const next = { ...prev };
          if (groupId === DEFAULT_VIEW_GROUP_ID) delete next[id];
          else next[id] = groupId;
          return next;
      });
  };
  const showTab = (id: string, opts?: { autoFillOnly?: boolean; newTab?: boolean }) => {
      const existingGroupId = tabGroups[id] ?? DEFAULT_VIEW_GROUP_ID
      if (!opts?.newTab && existingGroupId !== activeGroupId) {
          switchViewGroup(existingGroupId)
          const existingGroup = viewGroups.find(group => group.id === existingGroupId)
          const existingPane = existingGroup?.panes.findIndex(p => p === id) ?? -1
          if (existingPane >= 0) setFocusedPane(existingPane)
          return
      }
      const visibleIdx = panes.findIndex((p, i) => p === id && i < layoutMode);
      if (visibleIdx !== -1) {
          setFocusedPane(visibleIdx);
          return;
      }
      const emptyIdx = panes.findIndex((p, i) => p === null && i < layoutMode);
      if (emptyIdx !== -1) {
          setTabGroup(id, activeGroupId)
          setPanes(prev => prev.map((p, i) => (i === emptyIdx ? id : (p === id ? null : p))));
          setFocusedPane(emptyIdx);
          return;
      }
      if (opts?.newTab) {
          const nextGroupId = createNewViewGroup()
          setTabGroup(id, nextGroupId)
          // The new-tab path is a deliberate single-view reset. Do not derive this
          // update from the previous pane array: the group reset above is queued in
          // the same event and a stale functional update can retain panes from the
          // previous group. Those stale panes are then incorrectly pulled into the
          // next multi-view group, leaving the newly created terminal hidden.
          setPanes([id, ...Array(7).fill(null)])
          setFocusedPane(0)
          return
      }
      if (opts?.autoFillOnly && layoutMode > 1) {
          setPanes(prev => prev.map(p => (p === id ? null : p)));
          return;
      }
      setTabGroup(id, activeGroupId)
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
      const split3Style = appSettings.split3Style ?? 'left'
      const split2Style = appSettings.split2Style ?? 'columns'
      const currentOrder = paneOrder(layoutMode, split3Style, split2Style)
      const nextOrder = paneOrder(n, split3Style, split2Style)
      const currentVisible = currentOrder.map(index => panes[index])
      const focusedPosition = currentOrder.indexOf(focusedPane)
      const currentFocusedId = focusedPosition >= 0 ? currentVisible[focusedPosition] : null
      const retained = currentVisible.slice(0, n)
      const overflowIds = currentVisible.slice(n).filter((id): id is string => id !== null)

      if (currentFocusedId && focusedPosition >= n) {
          const displaced = retained[n - 1]
          retained[n - 1] = currentFocusedId
          if (displaced && displaced !== currentFocusedId) overflowIds.push(displaced)
      }

      const currentIds = currentVisible.filter((id): id is string => id !== null)
      const currentGroup = viewGroups.find(group => group.id === activeGroupId)
      const additionalIds = activeTabs
        .filter(tab => !currentIds.includes(tab.id) && !tabGroups[tab.id])
        .map(tab => tab.id)
      const candidateIds = [...currentIds, ...additionalIds]
      const orderedNext = Array.from({ length: n }, (_, index) => retained[index] ?? null)
      if (n > layoutMode) {
          for (const id of candidateIds) {
              if (orderedNext.includes(id)) continue
              const emptyIndex = orderedNext.findIndex(pane => pane === null)
              if (emptyIndex < 0) break
              orderedNext[emptyIndex] = id
          }
      }

      const next = Array(8).fill(null) as (string | null)[]
      nextOrder.forEach((paneIndex, orderIndex) => {
          next[paneIndex] = orderedNext[orderIndex] ?? null
      })
      const visibleNextIds = nextOrder
        .map(index => next[index])
        .filter((id): id is string => id !== null)
      const uniqueOverflowIds = [...new Set(overflowIds)].filter(id => !visibleNextIds.includes(id))

      if (activeGroupId !== DEFAULT_VIEW_GROUP_ID) {
          setTabGroups(prev => {
              const nextGroups = { ...prev }
              for (const id of uniqueOverflowIds) delete nextGroups[id]
              for (const id of visibleNextIds) {
                  if (currentGroup?.panes.includes(id) || !prev[id]) nextGroups[id] = activeGroupId
              }
              return nextGroups
          })
      }
      if (n !== layoutMode || next.some((pane, index) => pane !== panes[index])) {
          diag.debug('[Layout] changed view mode', {
              from: layoutMode,
              to: n,
              activeGroupId,
              focusedPane,
              kept: next.slice(0, n).filter(Boolean),
              overflow: uniqueOverflowIds,
          })
          setPanes(next)
      }
      setFullscreenPane(null)
      setLayoutMode(n);
      const nextFocusedPane = currentFocusedId
          ? next.findIndex(id => id === currentFocusedId)
          : -1
      setFocusedPane(nextFocusedPane >= 0 ? nextFocusedPane : n - 1)
      localStorage.setItem('cc.layoutMode', String(n));
  }, [appSettings.split2Style, appSettings.split3Style, createNewViewGroup, focusedPane, layoutMode, panes, setLayoutMode, setFullscreenPane, activeTabs, tabGroups, viewGroups, activeGroupId, setTabGroups]);
  useEffect(() => {
      const handleLayoutChange = (e: Event) => {
          const mode = (e as CustomEvent).detail.mode as LayoutMode;
          changeLayoutMode(mode);
      };
      window.addEventListener('omniterm:change-layout', handleLayoutChange);
      return () => window.removeEventListener('omniterm:change-layout', handleLayoutChange);
  }, [changeLayoutMode]);
  const assignToPane = (paneIndex: number, id: string) => {
      const replacedId = panes[paneIndex]
      setTabGroups(prev => {
          const next = { ...prev }
          if (replacedId && replacedId !== id) delete next[replacedId]
          if (activeGroupId === DEFAULT_VIEW_GROUP_ID) delete next[id]
          else next[id] = activeGroupId
          return next
      })
      setPanes(prev => prev.map((p, i) => (i === paneIndex ? id : (p === id ? null : p))));
      setFocusedPane(paneIndex);
      setPanePicker(null);
  };
  const clearPane = (paneIndex: number) => {
      const removedId = panes[paneIndex];
      if (removedId) {
          setTabGroups(prev => {
              const next = { ...prev };
              delete next[removedId];
              return next;
          });
      }
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
          showTab(sessionId, { autoFillOnly: true, newTab: true });
          return;
      }
      const alreadyOpen = !!activeTabs.find(t => t.connId === conn.id);
      if (!alreadyOpen) {
          setActiveTabs(prev => [...prev, { id: conn.id, connId: conn.id, name: conn.name }]);
      }
      showTab(conn.id, { autoFillOnly: !alreadyOpen, newTab: !alreadyOpen });
  };
  const pairRunWithEditor = (terminalId: string, editorId: string) => {
      if (layoutMode < 2)
          changeLayoutMode(2)
      setTabGroups(prev => ({ ...prev, [terminalId]: activeGroupId, [editorId]: activeGroupId }))
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
          showTab(id, { autoFillOnly: true, newTab: true });
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
  const closeTabs = (sessionIds: string[], skipConfirm = false, sessionAlreadyClosed = false) => {
      if (sessionIds.length === 0)
          return;
      if (!skipConfirm && !skipCloseConfirmRef.current) {
          const needsConfirm = sessionIds.some(id => {
              if (editorTabs[id])
                  return false;
              const s = statuses[id] || 'closed';
              if (s !== 'connected' && s !== 'connecting')
                  return false;
              // A local shell already at its prompt has no child process to terminate, so closing
              // it is safe and should not interrupt the user's flow with a confirmation modal.
              const conn = connById(activeTabs.find(t => t.id === id)?.connId);
              return !(s === 'connected' && conn?.type === 'LOCAL' && activity[id] === false);
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
      setTabGroups(prev => {
          const next = { ...prev };
          for (const id of sessionIds) delete next[id];
          return next;
      });
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
      const sessionId = panes[paneIndex]
      const target = sessionId && conn ? { id: sessionId, connId: conn.id } : null
      const sessionTitle = sessionId ? activeTabs.find(tab => tab.id === sessionId)?.name : undefined
      const resolved = target ? resolveAppearance?.(target.id, target.connId) : undefined
      const appearance = target && onThemeApply && onFontSizeChange ? {
          themes,
          themeId: resolved?.themeId ?? appSettings.themeId,
          fontSize: resolved?.fontSize ?? appSettings.fontSize,
          darkMode: appSettings.darkMode,
          onThemeApply: (themeId: string) => onThemeApply(themeId, target),
          onFontSizeChange: (delta: number) => onFontSizeChange(delta, target),
      } : undefined
      // Only LOCAL connections carry a shell identity; SSH/RDP headings use conn.name already.
      const paneShellLabel = conn?.type === 'LOCAL'
        ? getShellLabel(shellOptions ?? [], conn.shell)
        : undefined
      const paneBusy = conn?.type === 'LOCAL' && sessionId ? (activity[sessionId] ?? false) : undefined
      return <PaneHeader paneIndex={paneIndex} conn={conn} sessionTitle={sessionTitle} shellLabel={paneShellLabel} focused={paneIndex === focusedPane} sessionId={sessionId} tabs={activeTabs} panes={panes} layoutMode={layoutMode} statuses={statuses} connType={(connId) => connById(connId)?.type} pickerOpen={panePicker === paneIndex} pickerRef={panePickerRef} pickerAnchor={panePickerAnchor} detach={detachControl.stateOf(sessionId)} onToggleDetach={() => detachControl.toggle(sessionId)} onFocus={() => setFocusedPane(paneIndex)} onDragStart={() => setDragPane(paneIndex)} onDragEnd={() => setDragPane(null)} onTogglePicker={(anchor) => { if (panePicker === paneIndex) setPanePicker(null); else { setPanePickerAnchor(anchor); setPanePicker(paneIndex) } }} onAssign={(tabId) => assignToPane(paneIndex, tabId)} onClear={() => clearPane(paneIndex)} onClose={() => { if (sessionId) closeTab(sessionId) }} fullscreen={fullscreenPane === paneIndex} onToggleFullscreen={() => setFullscreenPane(current => current === paneIndex ? null : paneIndex)} appearance={appearance} busy={paneBusy}/>
  }
  return { showTab, removeFromPanes, changeLayoutMode, assignToPane, clearPane, swapPanes, handleConnect, pairRunWithEditor, scriptRuns, openEditor, noteShellOpenRef, disconnectByType, clearTabState, closeTabs, closeTab, disconnectSession, reconnectSession, activeSshId, activeSshName, STATUS_RANK, connStatuses, isOverlayOpen, detachControl, renderPaneHeader }
}
