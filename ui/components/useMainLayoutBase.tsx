import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Connection, SessionStatus, Workspace, WorkspaceScript } from '@omniterm/contract'
import type { ActivityView } from './ActivityBar'
import type { WorkspaceConnectionTarget } from './WorkspacePanel'
import { useDialog } from '../hooks/useDialog'
import { useSplitRatios } from '../hooks/useSplitRatios'
import { openNewSession } from '../newSession'
import { loadShellOptions, pickShell, type ShellOption } from '../shellOptions'
import { upsertWorkspaceConnection } from '../utils/workspaceConnections'
import { diag } from '../diag'
import { DEFAULT_SHORTCUTS, MAX_PLANES, type MainLayoutProps } from './mainLayoutShared'
import { useViewGroups } from '../hooks/useViewGroups'
import { useCustomArt } from '../hooks/useCustomArt'
import { visibleTabsForGroup } from '../viewGroups'
import { terminalWorkspaceSelection } from '../utils/workspaceHierarchy'
export function useMainLayoutBase({
  appSettings, setAppSettings, currentTheme, layoutMode, setLayoutMode, settingsOpen,
  setSettingsOpen, updateState, setUpdateState, themes = [currentTheme], zoomFactor,
  onZoomReset, resolveAppearance, onActiveTerminalChange, onFontSizeChange, onThemeApply,
  onSettingsReload,
}: MainLayoutProps) {
  const handleConnectRef = useRef<(connection: Connection) => void>(() => undefined)
  const appSettingsRef = useRef(appSettings)
  appSettingsRef.current = appSettings
  const shellOptionsRef = useRef<ShellOption[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() => {
      try { return localStorage.getItem('omniterm:last-workspace') } catch { return null }
  })
  const requestNewSession = useCallback((requestedShell?: string, requestedWorkspaceId?: string | null) => {
      const shell = requestedShell
          ?? pickShell(shellOptionsRef.current, appSettingsRef.current.defaultShell);
      const workspaceId = requestedWorkspaceId === undefined ? selectedWorkspaceId : requestedWorkspaceId;
      void openNewSession(shell, (conn) => {
          try {
              if (workspaceId) localStorage.setItem('omniterm:last-workspace', workspaceId)
              else localStorage.removeItem('omniterm:last-workspace')
          } catch { /* storage is optional */ }
          handleConnectRef.current(conn as Connection)
      }, workspaceId)
          .catch((err: unknown) => diag.error('[MainLayout] could not open a new session', err));
  }, [selectedWorkspaceId])
  const [hasConnectionProvider, setHasConnectionProvider] = useState(false);
  const [connectionCapabilities, setConnectionCapabilities] = useState<ConnectionProviderCapabilities | null>(null);
  useEffect(() => {
      Promise.all([
          window.omnitermAPI.plugin.list(),
          window.omnitermAPI.plugin.connectionCapabilities(),
      ])
          .then(([plugins, capabilities]) => {
          setHasConnectionProvider(plugins.some(p => p.selectedConnectionProvider && p.enabled));
          setConnectionCapabilities(capabilities);
      })
          .catch(diag.error);
  }, []);
  const [activeTabs, setActiveTabs] = useState<{
      id: string;
      connId: string;
      name: string;
  }[]>([]);
  const [ephemeralConns, setEphemeralConns] = useState<Connection[]>([]);
  const [savedConnections, setSavedConnections] = useState<Connection[]>([]);
  const [panes, setPanes] = useState<(string | null)[]>(Array(MAX_PLANES).fill(null));
  const [focusedPane, setFocusedPane] = useState(0);
  const [fullscreenPane, setFullscreenPane] = useState<number | null>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreenPane(null)
    }
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const activeTabId = panes[focusedPane] ?? null;
  const { viewGroups, activeGroupId, tabGroups, setTabGroups, switchViewGroup, createNewViewGroup } = useViewGroups({
      layoutMode, setLayoutMode, panes, setPanes, focusedPane, setFocusedPane,
  })
  const visibleTabs = visibleTabsForGroup(activeTabs, tabGroups, activeGroupId)
  const [tabMenu, setTabMenu] = useState<{
      x: number;
      y: number;
      tabId: string;
  } | null>(null);
  const [shellMenu, setShellMenu] = useState<{
      x: number;
      y: number;
  } | null>(null);
  const [pendingCloseTabIds, setPendingCloseTabIds] = useState<string[] | null>(null);
  const skipCloseConfirmRef = useRef(false);
  const [panePicker, setPanePicker] = useState<number | null>(null);
  const [panePickerAnchor, setPanePickerAnchor] = useState<DOMRect | null>(null);
  const panePickerRef = useRef<HTMLDivElement>(null);
  const [dragPane, setDragPane] = useState<number | null>(null);
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});
  const [reconnectKeys, setReconnectKeys] = useState<Record<string, number>>({});
  const [latencies, setLatencies] = useState<Record<string, number | null>>({});
  const [detached, setDetached] = useState<Record<string, boolean>>({});
  const [poppedOut, setPoppedOut] = useState<Record<string, boolean>>({});
  const [resumeMode, setResumeMode] = useState<Record<string, boolean>>({});
  const [metrics, setMetrics] = useState<Record<string, SessionMetrics>>({});
  const [connectedAt, setConnectedAt] = useState<Record<string, number>>({});
  const { idleArtUrl, loadingArtUrl, idleArtUrlLight, idleArtUrlDark, loadingArtUrlLight, loadingArtUrlDark, refreshCustomArt } = useCustomArt(!!appSettings.darkMode)
  const setStatus = useCallback((id: string, status: SessionStatus) => {
      setStatuses(prev => (prev[id] === status ? prev : { ...prev, [id]: status }));
  }, []);
  const setLatency = useCallback((id: string, ms: number | null) => {
      setLatencies(prev => (prev[id] === ms ? prev : { ...prev, [id]: ms }));
  }, []);
  const setMetric = useCallback((id: string, m: SessionMetrics) => {
      setMetrics(prev => ({ ...prev, [id]: m }));
  }, []);
  const [activity, setActivity] = useState<Record<string, boolean>>({});
  const setBusy = useCallback((id: string, busy: boolean) => {
      setActivity(prev => (prev[id] === busy ? prev : { ...prev, [id]: busy }));
  }, []);
  const connById = useCallback((id?: string): Connection | undefined => ephemeralConns.find(c => c.id === id) ?? savedConnections.find(c => c.id === id), [ephemeralConns, savedConnections]);
  useEffect(() => {
      setConnectedAt(prev => {
          let changed = false;
          const next = { ...prev };
          for (const [id, st] of Object.entries(statuses)) {
              if (st === 'connected' && next[id] == null) {
                  next[id] = Date.now();
                  changed = true;
              }
              else if (st !== 'connected' && next[id] != null) {
                  delete next[id];
                  changed = true;
              }
          }
          return changed ? next : prev;
      });
  }, [statuses]);
  const toggleDetach = useCallback((id: string) => {
      setDetached(prev => {
          const next = !prev[id];
          window.omnitermAPI.connect.rdpSetDetached(id, next);
          return { ...prev, [id]: next };
      });
  }, []);
  useEffect(() => {
      return window.omnitermAPI.connect.onRDPDetachState((id, isDetached) => {
          setDetached(prev => (prev[id] === isDetached ? prev : { ...prev, [id]: isDetached }));
      });
  }, []);
  const canDetachWindow = typeof window.omnitermAPI.terminalWindow?.detach === 'function';
  const updateFontSize = useCallback((delta: number) => {
      const currentSize = appSettings.fontSize || 14;
      const nextSize = Math.max(8, Math.min(48, currentSize + delta));
      const nextSettings = { ...appSettings, fontSize: nextSize };
      setAppSettings(nextSettings);
      window.omnitermAPI.settings.save(nextSettings);
  }, [appSettings, setAppSettings]);
  const popOutTerminal = useCallback((id: string) => {
      const tab = activeTabs.find(t => t.id === id);
      const conn = connById(tab?.connId);
      if (!tab || !conn || conn.type === 'RDP')
          return;
      void window.omnitermAPI.terminalWindow.detach({ sessionId: id, name: tab.name, connection: conn }).then(ok => {
          if (!ok)
              return;
          setResumeMode(prev => ({ ...prev, [id]: true }));
          setPoppedOut(prev => ({ ...prev, [id]: true }));
      });
  }, [activeTabs, connById]);
  const reattachTerminal = useCallback((id: string) => {
      void window.omnitermAPI.terminalWindow.reattach(id);
  }, []);
  useEffect(() => {
      if (!window.omnitermAPI.terminalWindow)
          return;
      return window.omnitermAPI.terminalWindow.onReattached((id) => {
          setPoppedOut(prev => (prev[id] ? { ...prev, [id]: false } : prev));
          onSettingsReload?.(id);
      });
  }, [onSettingsReload]);
  const focusTerminal = (id: string) => {
      window.dispatchEvent(new CustomEvent('omniterm:focus-terminal', { detail: { id } }));
  };
  const [connFormOpen, setConnFormOpen] = useState(false);
  const [connFormInitial, setConnFormInitial] = useState<Connection | undefined>(undefined);
  const [connFormTarget, setConnFormTarget] = useState<WorkspaceConnectionTarget | null>(null);
  const wsConnFormRef = useRef<string | null>(null);
  const [wsConnectionsRevision, setWsConnectionsRevision] = useState(0);
  const openConnectionForm = (target: WorkspaceConnectionTarget) => {
      setConnFormTarget(target);
      wsConnFormRef.current = target.workspaceId;
      setConnFormOpen(true);
  };
  const [recordingAction, setRecordingAction] = useState<string | null>(null);
  const { dialogState, showAlert, showConfirm } = useDialog();
  useEffect(() => {
      if (!recordingAction)
          return;
      const handleRecordKey = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (['control', 'shift', 'alt', 'meta'].includes(e.key.toLowerCase())) {
              return;
          }
          const parts: string[] = [];
          if (e.ctrlKey || e.metaKey)
              parts.push('Ctrl');
          if (e.shiftKey)
              parts.push('Shift');
          if (e.altKey)
              parts.push('Alt');
          let keyName = e.key;
          if (keyName === ' ')
              keyName = 'Space';
          if (keyName.length === 1) {
              keyName = keyName.toUpperCase();
          }
          parts.push(keyName);
          const combo = parts.join('+');
          const lowerCombo = combo.toLowerCase();
          if (lowerCombo === 'ctrl+r' || lowerCombo === 'ctrl+f5') {
              showAlert('Ctrl+R and Ctrl+F5 are native Chromium shortcuts and cannot be changed.', { title: 'Reserved Shortcut', tone: 'warning' });
              setRecordingAction(null);
              return;
          }
          const currentShortcuts = appSettings.shortcuts || DEFAULT_SHORTCUTS;
          const updated = {
              ...currentShortcuts,
              [recordingAction]: combo
          };
          const nextSettings = {
              ...appSettings,
              shortcuts: updated
          };
          setAppSettings(nextSettings);
          window.omnitermAPI.settings.save(nextSettings);
          setRecordingAction(null);
      };
      window.addEventListener('keydown', handleRecordKey, true);
      return () => {
          window.removeEventListener('keydown', handleRecordKey, true);
      };
  }, [recordingAction, appSettings, setAppSettings]);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const dataMenuRef = useRef<HTMLDivElement>(null);
  const dataMenuBtnRef = useRef<HTMLButtonElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const sidebarWidthRef = useRef(220);
  const isResizing = useRef(false);
  const [activeView, setActiveView] = useState<ActivityView | null>('workspace');
  const [alwaysAwake, setAlwaysAwake] = useState<AlwaysAwakeStatus>({
      enabled: false,
      mode: 'activeOnly',
      expiresAtMs: 0,
      activeSessionCount: 0,
      keepingAwake: false,
      supported: true,
      error: null,
  });
  const [alwaysAwakeOpen, setAlwaysAwakeOpen] = useState(false);
  const [alwaysAwakeAvailable, setAlwaysAwakeAvailable] = useState(false);
  useEffect(() => {
      let unsubscribe: (() => void) | null = null;
      let cancelled = false;
      void window.omnitermAPI.plugin.invoke('alwaysAwake.info')
          .then((info) => {
              if (cancelled || !info) return;
              setAlwaysAwakeAvailable(true);
              void window.omnitermAPI.alwaysAwake.getState().then(setAlwaysAwake).catch(diag.error);
              unsubscribe = window.omnitermAPI.alwaysAwake.onState(setAlwaysAwake);
          })
          .catch(diag.error);
      return () => {
          cancelled = true;
          unsubscribe?.();
      };
  }, []);
  const lastViewRef = useRef<ActivityView>('workspace');
  const sidebarVisible = activeView !== null;
  const [editorTabs, setEditorTabs] = useState<Record<string, {
      workspaceId: string;
      script: WorkspaceScript;
  }>>({});
  const [editorDirty, setEditorDirty] = useState<Record<string, boolean>>({});
  const [previewTabId, setPreviewTabId] = useState<string | null>(null);
  const keepTab = useCallback((id: string) => {
      setPreviewTabId(prev => (prev === id ? null : prev));
  }, []);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  useEffect(() => {
      const saved = localStorage.getItem('cc.sidebarWidth');
      if (saved) {
          const w = Math.max(180, Math.min(520, parseInt(saved, 10)));
          setSidebarWidth(w);
          sidebarWidthRef.current = w;
      }
      const savedView = localStorage.getItem('cc.activeView');
      if (savedView === 'workspace' || savedView === 'files') {
          setActiveView(savedView);
          lastViewRef.current = savedView;
      }
      else if (savedView === 'connections') {
          setActiveView('workspace');
          lastViewRef.current = 'workspace';
          localStorage.setItem('cc.activeView', 'workspace');
      }
      else if (savedView === 'null') {
          setActiveView(null);
      }
      const handleNewSession = (e: Event) => {
          requestNewSession((e as CustomEvent).detail?.shell);
      };
      const handleToggleSidebar = () => {
          setActiveView(prev => {
              if (prev !== null) {
                  lastViewRef.current = prev;
                  localStorage.setItem('cc.activeView', 'null');
                  return null;
              }
              const restored = lastViewRef.current;
              localStorage.setItem('cc.activeView', restored);
              return restored;
          });
      };
      const handleCommandPalette = () => {
          setCommandPaletteOpen(true);
      };
      window.addEventListener('omniterm:new-session', handleNewSession);
      window.addEventListener('omniterm:toggle-sidebar', handleToggleSidebar);
      window.addEventListener('omniterm:command-palette', handleCommandPalette);
      return () => {
          window.removeEventListener('omniterm:new-session', handleNewSession);
          window.removeEventListener('omniterm:toggle-sidebar', handleToggleSidebar);
          window.removeEventListener('omniterm:command-palette', handleCommandPalette);
      };
  }, [requestNewSession]);
  const handleResizeDragStart = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidthRef.current;
      const onMouseMove = (ev: MouseEvent) => {
          const newWidth = Math.max(200, Math.min(520, startWidth + ev.clientX - startX));
          setSidebarWidth(newWidth);
          sidebarWidthRef.current = newWidth;
      };
      const onMouseUp = () => {
          isResizing.current = false;
          localStorage.setItem('cc.sidebarWidth', String(sidebarWidthRef.current));
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
  }, []);
  const handleViewChange = useCallback((view: ActivityView | null) => {
      if (view !== null)
          lastViewRef.current = view;
      setActiveView(view);
      localStorage.setItem('cc.activeView', String(view));
  }, []);
  const [revealRequest, setRevealRequest] = useState<{
      workspaceId: string;
      path: string;
      nonce: number;
  } | null>(null);
  const revealNonce = useRef(0);
  const revealInWorkspace = useCallback((tabId: string) => {
      const editor = editorTabs[tabId];
      if (!editor)
          return;
      handleViewChange('workspace');
      revealNonce.current += 1;
      setRevealRequest({ workspaceId: editor.workspaceId, path: editor.script.id, nonce: revealNonce.current });
  }, [editorTabs, handleViewChange]);
  const aboutOpen = settingsOpen; const setAboutOpen = setSettingsOpen;
  const [updateChecking, setUpdateChecking] = useState(false);
  const [installerChoiceOpen, setInstallerChoiceOpen] = useState(false);
  const [splitRatios, setSplitRatios, persistRatios] = useSplitRatios(appSettings, setAppSettings);
  const [shellOptions, setShellOptions] = useState<ShellOption[]>([]);
  useEffect(() => {
      void loadShellOptions().then(opts => {
          shellOptionsRef.current = opts;
          setShellOptions(opts);
      });
  }, []);
  const refreshWorkspaces = useCallback(async () => {
      await window.omnitermAPI.workspace.list().then(list => {
          setWorkspaces(list)
          setSelectedWorkspaceId(current => terminalWorkspaceSelection(list, current))
      }).catch(() => setWorkspaces([]))
  }, [])
  useEffect(() => { void refreshWorkspaces() }, [refreshWorkspaces])
  useEffect(() => {
      let cancelled = false;
      void (async () => {
          try {
              const workspaces = await window.omnitermAPI.workspace.list();
              const lists = await Promise.all(workspaces.map(ws => window.omnitermAPI.workspace.loadConnections(ws.id)));
              if (!cancelled)
                  setSavedConnections(lists.flat());
          }
          catch (error) {
              diag.error('[MainLayout] could not load workspace connections', error);
          }
      })();
      return () => { cancelled = true; };
  }, [wsConnectionsRevision]);
  useEffect(() => {
      if (!dataMenuOpen)
          return;
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape')
          setDataMenuOpen(false); };
      const onClick = (e: MouseEvent) => {
          const target = e.target instanceof Node ? e.target : null;
          const insideMenu = !!target && !!dataMenuRef.current?.contains(target);
          const insideBtn = !!target && !!dataMenuBtnRef.current?.contains(target);
          if (dataMenuRef.current && !insideMenu && dataMenuBtnRef.current && !insideBtn)
              setDataMenuOpen(false);
      };
      window.addEventListener('keydown', onKey);
      window.addEventListener('mousedown', onClick);
      return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
  }, [dataMenuOpen]);
  const checkForUpdates = async () => {
      setInstallerChoiceOpen(false);
      setUpdateChecking(true);
      try {
          setUpdateState(await window.omnitermAPI.updates.check());
      }
      catch (err) {
          await showAlert(`Could not check for updates: ${err instanceof Error ? err.message : String(err)}`, {
              title: 'Update Check Failed',
              tone: 'error',
          });
      }
      finally {
          setUpdateChecking(false);
      }
  };
  const handleDownloadPortable = async () => {
      if (!updateState?.latest)
          return;
      const defaultName = `OmniTerm-Portable-${updateState.latest}.exe`;
      const savePath = await window.omnitermAPI.updates.showSaveDialog(defaultName);
      if (!savePath)
          return;
      try {
          setUpdateChecking(true);
          await window.omnitermAPI.updates.downloadPortable(savePath);
      }
      catch (err) {
          showAlert(`Download failed: ${err instanceof Error ? err.message : String(err)}`, { title: 'Download Error', tone: 'error' });
      }
      finally {
          setUpdateChecking(false);
      }
  };
  const handleDownloadInstaller = async (installNow: boolean) => {
      setInstallerChoiceOpen(false);
      try {
          setUpdateChecking(true);
          await window.omnitermAPI.updates.downloadInstaller(installNow);
      }
      catch (err) {
          showAlert(`Download failed: ${err instanceof Error ? err.message : String(err)}`, { title: 'Download Error', tone: 'error' });
      }
      finally {
          setUpdateChecking(false);
      }
  };
  const skipThisVersion = async () => {
      if (updateState?.latest)
          setUpdateState(await window.omnitermAPI.updates.skip(updateState.latest));
  };
  const clearSkippedVersion = async () => {
      const s = await window.omnitermAPI.updates.skip(null);
      setUpdateState(s);
  };
  const handleSaveConnection = async (conn: Connection) => {
      const wsId = wsConnFormRef.current;
      if (!wsId)
          return;
      wsConnFormRef.current = null;
      try {
          await upsertWorkspaceConnection(wsId, conn, !!connFormInitial);
          setWsConnectionsRevision(v => v + 1);
          setEphemeralConns(prev => prev.map(c => (c.id === conn.id ? { ...c, ...conn } : c)));
          setActiveTabs(prev => {
              let instanceIdx = 0;
              return prev.map(t => {
                  if (t.connId !== conn.id)
                      return t;
                  instanceIdx++;
                  return { ...t, name: instanceIdx > 1 ? `${conn.name} (${instanceIdx})` : conn.name };
              });
          });
      }
      catch (error) {
          await showAlert(`Could not save the connection: ${error instanceof Error ? error.message : String(error)}`, { title: 'Workspace connection', tone: 'error' });
      }
  };
  return { appSettings, setAppSettings, currentTheme, themes, zoomFactor, onZoomReset, resolveAppearance, onActiveTerminalChange, onFontSizeChange, onThemeApply, onSettingsReload, layoutMode, setLayoutMode, settingsOpen, setSettingsOpen, updateState, setUpdateState, hasConnectionProvider, setHasConnectionProvider, connectionCapabilities, setConnectionCapabilities, activeTabs, visibleTabs, setActiveTabs, tabGroups, setTabGroups, viewGroups, activeGroupId, switchViewGroup, createNewViewGroup, ephemeralConns, setEphemeralConns, savedConnections, setSavedConnections, panes, setPanes, focusedPane, setFocusedPane, fullscreenPane, setFullscreenPane, activeTabId, tabMenu, setTabMenu, shellMenu, setShellMenu, pendingCloseTabIds, setPendingCloseTabIds, skipCloseConfirmRef, panePicker, setPanePicker, panePickerAnchor, setPanePickerAnchor, panePickerRef, dragPane, setDragPane, statuses, setStatuses, reconnectKeys, setReconnectKeys, latencies, setLatencies, detached, setDetached, poppedOut, setPoppedOut, resumeMode, setResumeMode, metrics, setMetrics, connectedAt, setConnectedAt, setStatus, setLatency, setMetric, activity, setActivity, setBusy, connById, toggleDetach, canDetachWindow, updateFontSize, popOutTerminal, reattachTerminal, focusTerminal, connFormOpen, setConnFormOpen, connFormInitial, setConnFormInitial, connFormTarget, wsConnFormRef, wsConnectionsRevision, setWsConnectionsRevision, openConnectionForm, recordingAction, setRecordingAction, dialogState, showAlert, showConfirm, dataMenuOpen, setDataMenuOpen, dataMenuRef, dataMenuBtnRef, sidebarWidth, setSidebarWidth, sidebarWidthRef, isResizing, activeView, setActiveView, lastViewRef, sidebarVisible, editorTabs, setEditorTabs, editorDirty, setEditorDirty, previewTabId, setPreviewTabId, keepTab, commandPaletteOpen, setCommandPaletteOpen, handleResizeDragStart, handleViewChange, revealRequest, setRevealRequest, revealNonce, revealInWorkspace, aboutOpen, setAboutOpen, updateChecking, setUpdateChecking, installerChoiceOpen, setInstallerChoiceOpen, splitRatios, setSplitRatios, persistRatios, shellOptions, setShellOptions, shellOptionsRef, workspaces, selectedWorkspaceId, setSelectedWorkspaceId, refreshWorkspaces, requestNewSession, checkForUpdates, handleDownloadPortable, handleDownloadInstaller, skipThisVersion, clearSkippedVersion, handleSaveConnection, handleConnectRef, idleArtUrl, loadingArtUrl, refreshCustomArt, idleArtUrlLight, idleArtUrlDark, loadingArtUrlLight, loadingArtUrlDark, alwaysAwake, setAlwaysAwake, alwaysAwakeOpen, setAlwaysAwakeOpen, alwaysAwakeAvailable }
}
