import React, { useState, useEffect, useCallback, useRef } from 'react'
import ActivityBar, { type ActivityView } from './ActivityBar'
import FileBrowser from './FileBrowser'
import WorkspacePanel, { type WorkspaceConnectionTarget } from './WorkspacePanel'
import ScriptViewer from './ScriptViewer'
import TerminalView from './TerminalView'
import RDPView from './RDPView'
import ConnectingOverlay from './ConnectingOverlay'
import UpdateSettings from './UpdateSettings'
import DetachedPlaceholder from './DetachedPlaceholder'
import ConnectionForm from './ConnectionForm'
import DialogHost from './DialogHost'
import PluginManager from './PluginManager'
import { useDialog } from '../hooks/useDialog'
import MetricsChips from './SessionMetricsChips'
import { Terminal, Monitor, Unplug, RotateCw, Loader2, X, Maximize2, Minimize2, ExternalLink, FileText, Square, Columns2, LayoutGrid, Trash2, ArrowLeft, ArrowRight, XCircle, PanelLeft } from 'lucide-react'
import CloseConfirmModal from './CloseConfirmModal'
import { appLogo } from '../assets/appLogo'
import { AppTheme, LayoutMode } from '../themes'
import { CommandPalette } from './CommandPalette'
import SessionTabs from './SessionTabs'
import PaneHeader from './PaneHeader'
import WaitingPane from './WaitingPane'
import { activityLabel, STATUS_DOT, STATUS_LABEL, STATUS_TEXT } from '../tabVisuals'
import { paneIdentity } from '../paneIdentity'
import { openNewSession } from '../newSession'
import { loadShellOptions, pickShell, shellLabel, type ShellOption } from '../shellOptions'
import { paneRect } from '../paneLayout'
import { closesOnExit } from '../sessionExit'
import { detachTitle } from '../detachControl'
import { useDetachControl } from '../hooks/useDetachControl'
import { useSplitRatios } from '../hooks/useSplitRatios'
import { useScriptRuns, editorTabId } from '../hooks/useScriptRuns'
import { upsertWorkspaceConnection } from '../utils/workspaceConnections'
import { PaneResizers } from './PaneResizers'
// ── Public types (imported by Sidebar, ConnectionForm, TerminalView, FolderForm) ──
// The canonical shapes now live in the shared plugin contract (@omniterm/contract) so the host
// and any connection-manager plugin agree on them. Re-exported here so the many `./MainLayout`
// imports across the renderer keep working unchanged.
import type { LocalShell, Connection, Folder, SessionStatus, WorkspaceScript } from '@omniterm/contract'
import { diag } from '../diag'
export type { LocalShell, Connection, Folder, SessionStatus }

interface MainLayoutProps {
  appSettings: AppSettings
  setAppSettings: (s: AppSettings) => void
  currentTheme: AppTheme
  layoutMode: LayoutMode
  setLayoutMode: (m: LayoutMode) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  updateState: UpdateState | null
  setUpdateState: (s: UpdateState | null) => void
}
const CtxItem: React.FC<{ label: string; icon: React.ReactNode; color: string; onClick: () => void }> = ({ label, icon, color, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-theme-bg/50 transition-colors ${color}`}
  >
    {icon}
    <span className="truncate">{label}</span>
  </button>
)
/**
 * Session id for a freshly launched instance of `conn`. SSH/RDP reuse the connection id
 * (at most one running instance); LOCAL mints a fresh id per launch so the same saved shell
 * can run as several independent instances at once. Exported for unit testing.
 *
 * The separator is `_`, not `#`: a session id is also used to name per-session Tauri events, which
 * only accept `[A-Za-z0-9-/:_]`. Nothing parses the separator back out.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function mintSessionId(conn: { id: string; type: Connection['type'] }): string {
  return conn.type === 'LOCAL' ? `${conn.id}_${crypto.randomUUID().slice(0, 8)}` : conn.id
}
// ── Split-view pane geometry ────────────────────────────────────────────────────

const Grid6Icon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
    <path d="M3 12h18" />
  </svg>
)

const Grid8Icon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7.5 3v18" />
    <path d="M12 3v18" />
    <path d="M16.5 3v18" />
    <path d="M3 12h18" />
  </svg>
)


/** Number of panes the state array must hold to cover the largest layout mode. */
const MAX_PLANES = 8

const shortcutLabels = {
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  newSession: 'New Session',
  newFolder: 'New Folder',
  openSettings: 'Open Settings',
  toggleThemeMode: 'Toggle Light/Dark',
  layout1: 'Grid 1 Layout',
  layout2: 'Grid 2 Layout',
  layout4: 'Grid 4 Layout',
  layout6: 'Grid 6 Layout',
  layout8: 'Grid 8 Layout',
  toggleSidebar: 'Toggle Sidebar',
  commandPalette: 'Command Palette'
}

const DEFAULT_SHORTCUTS = {
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  newSession: 'Ctrl+N',
  newFolder: 'Ctrl+Shift+N',
  openSettings: 'Ctrl+,',
  toggleThemeMode: 'Ctrl+/',
  layout1: 'Ctrl+1',
  layout2: 'Ctrl+2',
  layout4: 'Ctrl+4',
  layout6: 'Ctrl+6',
  layout8: 'Ctrl+8',
  toggleSidebar: 'Ctrl+B',
  commandPalette: 'Ctrl+P',
  closeTab: 'Ctrl+W'
}
// ── Component ─────────────────────────────────────────────────────────────────

const MainLayout: React.FC<MainLayoutProps> = ({
  appSettings,
  setAppSettings,
  currentTheme,
  layoutMode,
  setLayoutMode,
  settingsOpen,
  setSettingsOpen,
  updateState,
  setUpdateState,
}) => {
  const [hasConnectionProvider, setHasConnectionProvider] = useState(false)
  const [connectionCapabilities, setConnectionCapabilities] =
    useState<ConnectionProviderCapabilities | null>(null)

  // Fetch initial plugin state since PluginManager is only mounted in the settings modal
  useEffect(() => {
    Promise.all([
      window.omnitermAPI.plugin.list(),
      window.omnitermAPI.plugin.connectionCapabilities(),
    ])
      .then(([plugins, capabilities]) => {
        setHasConnectionProvider(plugins.some(p => p.selectedConnectionProvider && p.enabled))
        setConnectionCapabilities(capabilities)
      })
      .catch(diag.error)
  }, [])
  // A tab is one running instance. `id` is the per-instance session key used for panes,
  // IPC channels, and every per-tab status/metrics map; `connId` is the saved connection it
  // launched from. For SSH/RDP `id === connId` (always exactly one instance). LOCAL mints a
  // fresh `id` per launch, so the same saved shell can run as several independent tabs.
  const [activeTabs, setActiveTabs] = useState<{ id: string; connId: string; name: string }[]>([])
  /**
   * Every connection this session has actually opened: workspace profiles the user connected to, and
   * ad-hoc LOCAL shells spawned by the launcher (nc-open) or a script run.
   *
   * The renderer keeps no saved connection list of its own — connections live in the workspace they
   * belong to and are loaded by WorkspacePanel — so this is the whole universe `connById` resolves
   * against, and it is populated on connect (see `handleConnect`).
   */
  const [ephemeralConns, setEphemeralConns] = useState<Connection[]>([])
  /**
   * Every connection saved across all pinned workspaces, flattened.
   *
   * WorkspacePanel loads them per workspace for its tree; the command palette needs one list covering
   * all of them so a connection can be opened without expanding its workspace first.
   */
  const [savedConnections, setSavedConnections] = useState<Connection[]>([])
  // Split view. `panes` is ALWAYS length MAX_PLANES (session id per slot, or null
  // for empty); only slots [0, layoutMode) are visible, and a session id appears
  // in at most one slot. `activeTabId` is derived from the focused pane so its
  // ~20 read sites (footer, SFTP target, sudo dispatch, tab highlight) automatically
  // follow the focus.
  const [panes, setPanes] = useState<(string | null)[]>(Array(MAX_PLANES).fill(null))
  const [focusedPane, setFocusedPane] = useState(0)
  const activeTabId = panes[focusedPane] ?? null
  const [tabMenu, setTabMenu] = useState<{ x: number, y: number, tabId: string } | null>(null)
  const [shellMenu, setShellMenu] = useState<{ x: number, y: number } | null>(null)
  const [pendingCloseTabIds, setPendingCloseTabIds] = useState<string[] | null>(null)
  const skipCloseConfirmRef = useRef(false)
  // Which pane's session-picker dropdown is open, and the pane currently being dragged
  // (for drop-target highlighting). While either is set, RDP windows are hidden via the
  // overlay so DOM chrome (the dropdown / drop targets) is not occluded by the native window.
  const [panePicker, setPanePicker] = useState<number | null>(null)
  const panePickerRef = useRef<HTMLDivElement>(null)
  const [dragPane, setDragPane] = useState<number | null>(null)
  // Per-tab live SSH status and a remount nonce used to force reconnect.
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({})
  const [reconnectKeys, setReconnectKeys] = useState<Record<string, number>>({})
  // Per-tab RDP latency in ms (null = unreachable). Per-tab "detached" (popped out to a
  // maximized native window — native RDP fullscreen feel).
  const [latencies, setLatencies] = useState<Record<string, number | null>>({})
  const [detached, setDetached] = useState<Record<string, boolean>>({})
  // Per-tab SSH/local session popped out into its own OS window (distinct from RDP's `detached`
  // fullscreen). While true the in-main TerminalView unmounts and a placeholder shows; the PTY/SSH
  // keeps running in the main process. `resumeMode` latches so the next in-main mount ATTACHES
  // (replay) instead of reconnecting (which would duplicate the session).
  const [poppedOut, setPoppedOut] = useState<Record<string, boolean>>({})
  const [resumeMode, setResumeMode] = useState<Record<string, boolean>>({})
  // Per-tab live SSH metrics (remote CPU/RAM/disk + latency) and the timestamp each
  // session first reached 'connected' (for the uptime chip).
  const [metrics, setMetrics] = useState<Record<string, SessionMetrics>>({})
  const [connectedAt, setConnectedAt] = useState<Record<string, number>>({})

  const setStatus = useCallback((id: string, status: SessionStatus) => {
    setStatuses(prev => (prev[id] === status ? prev : { ...prev, [id]: status }))
  }, [])

  const setLatency = useCallback((id: string, ms: number | null) => {
    setLatencies(prev => (prev[id] === ms ? prev : { ...prev, [id]: ms }))
  }, [])

  const setMetric = useCallback((id: string, m: SessionMetrics) => {
    setMetrics(prev => ({ ...prev, [id]: m }))
  }, [])
  // Per-tab "the shell is running something" (LOCAL only — see TerminalView's onActivity). Absent
  // means unknown, which every consumer treats as idle.
  const [activity, setActivity] = useState<Record<string, boolean>>({})
  const setBusy = useCallback((id: string, busy: boolean) => {
    setActivity(prev => (prev[id] === busy ? prev : { ...prev, [id]: busy }))
  }, [])
  // Resolve a connId: what this session opened first (it carries any live ad-hoc shell), then the
  // saved workspace profiles.
  const connById = useCallback(
    (id?: string): Connection | undefined =>
      ephemeralConns.find(c => c.id === id) ?? savedConnections.find(c => c.id === id),
    [ephemeralConns, savedConnections],
  )
  // Track connection uptime: stamp connectedAt when a session first reaches 'connected',
  // clear it on any other status. Reconnect (connecting → connected) naturally resets it.
  useEffect(() => {
    setConnectedAt(prev => {
      let changed = false
      const next = { ...prev }
      for (const [id, st] of Object.entries(statuses)) {
        if (st === 'connected' && next[id] == null) { next[id] = Date.now(); changed = true }
        else if (st !== 'connected' && next[id] != null) { delete next[id]; changed = true }
      }
      return changed ? next : prev
    })
  }, [statuses])

  const toggleDetach = useCallback((id: string) => {
    setDetached(prev => {
      const next = !prev[id]
      window.omnitermAPI.connect.rdpSetDetached(id, next)
      return { ...prev, [id]: next }
    })
  }, [])
  // Keep the footer fullscreen icon in sync when detach state changes from the main
  // process — e.g. the user pressed "Restore" on the floating fullscreen bar (or the
  // Esc safety-net hotkey), not the footer button.
  useEffect(() => {
    return window.omnitermAPI.connect.onRDPDetachState((id, isDetached) => {
      setDetached(prev => (prev[id] === isDetached ? prev : { ...prev, [id]: isDetached }))
    })
  }, [])
  // Detach-to-window is real now (src-tauri/src/terminal_window.rs); this used to be a truthiness
  // check against a stub that always failed, which rendered a button that silently did nothing.
  const canDetachWindow = typeof window.omnitermAPI.terminalWindow?.detach === 'function'

  const updateFontSize = useCallback((delta: number) => {
    const currentSize = appSettings.fontSize || 14
    const nextSize = Math.max(8, Math.min(48, currentSize + delta))
    const nextSettings = { ...appSettings, fontSize: nextSize }
    setAppSettings(nextSettings)
    window.omnitermAPI.settings.save(nextSettings)
  }, [appSettings, setAppSettings])

  // Pop a SSH/local terminal out into its own OS window (session keeps running in main).
  const popOutTerminal = useCallback((id: string) => {
    const tab = activeTabs.find(t => t.id === id)
    const conn = connById(tab?.connId)
    if (!tab || !conn || conn.type === 'RDP') return
    void window.omnitermAPI.terminalWindow.detach({ sessionId: id, name: tab.name, connection: conn }).then(ok => {
      if (!ok) return
      setResumeMode(prev => ({ ...prev, [id]: true }))
      setPoppedOut(prev => ({ ...prev, [id]: true }))
    })
  }, [activeTabs, connById])
  // Fold a popped-out window back in; main closes it and fires onReattached below.
  const reattachTerminal = useCallback((id: string) => {
    void window.omnitermAPI.terminalWindow.reattach(id)
  }, [])
  // Popped-out window closed and ownership returned here — clear poppedOut so the tab remounts
  // (resumeMode keeps it attach, re-binding to the still-running session).
  useEffect(() => {
    if (!window.omnitermAPI.terminalWindow) return
    return window.omnitermAPI.terminalWindow.onReattached((id) => {
      setPoppedOut(prev => (prev[id] ? { ...prev, [id]: false } : prev))
    })
  }, [])
  const focusTerminal = (id: string) => {
    window.dispatchEvent(new CustomEvent('omniterm:focus-terminal', { detail: { id } }))
  }
  // Connection form: closed unless `connFormOpen`; undefined initial = create, Connection = edit.
  const [connFormOpen, setConnFormOpen] = useState(false)
  const [connFormInitial, setConnFormInitial] = useState<Connection | undefined>(undefined)
  /**
   * Which workspace folder the open form is filing into: the folder list for its Parent Folder select,
   * the folder the user clicked (pre-selected), and the workspace name shown as that select's root.
   * Supplied by WorkspacePanel, which owns the scan the tree is built from.
   */
  const [connFormTarget, setConnFormTarget] = useState<WorkspaceConnectionTarget | null>(null)
  // The workspace the form saves to. A ref, not state: `handleSaveConnection` reads it after an await.
  const wsConnFormRef = useRef<string | null>(null)
  // Bumped after a workspace connection is written, so WorkspacePanel reloads its list.
  const [wsConnectionsRevision, setWsConnectionsRevision] = useState(0)

  /** Open the connection form against a workspace folder (create or edit — `initial` is set first). */
  const openConnectionForm = (target: WorkspaceConnectionTarget) => {
    setConnFormTarget(target)
    wsConnFormRef.current = target.workspaceId
    setConnFormOpen(true)
  }

  const [recordingAction, setRecordingAction] = useState<string | null>(null)

  const { dialogState, showAlert, showConfirm } = useDialog()

  useEffect(() => {
    if (!recordingAction) return

    const handleRecordKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Ignore modifier keys on their own
      if (['control', 'shift', 'alt', 'meta'].includes(e.key.toLowerCase())) {
        return
      }
      // Build key combo representation
      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')
      
      let keyName = e.key
      if (keyName === ' ') keyName = 'Space'
      if (keyName.length === 1) {
        keyName = keyName.toUpperCase()
      }

      parts.push(keyName)
      const combo = parts.join('+')
      // Validate: block Ctrl+R and Ctrl+F5
      const lowerCombo = combo.toLowerCase()
      if (lowerCombo === 'ctrl+r' || lowerCombo === 'ctrl+f5') {
        showAlert('Ctrl+R and Ctrl+F5 are native Chromium shortcuts and cannot be changed.', { title: 'Reserved Shortcut', tone: 'warning' })
        setRecordingAction(null)
        return
      }

      const currentShortcuts = appSettings.shortcuts || DEFAULT_SHORTCUTS

      const updated = {
        ...currentShortcuts,
        [recordingAction]: combo
      }

      const nextSettings = {
        ...appSettings,
        shortcuts: updated
      }

      setAppSettings(nextSettings)
      window.omnitermAPI.settings.save(nextSettings)

      setRecordingAction(null)
    }

    window.addEventListener('keydown', handleRecordKey, true)
    return () => {
      window.removeEventListener('keydown', handleRecordKey, true)
    }
  }, [recordingAction, appSettings, setAppSettings])
  // Data menu (import/export popover)
  const [dataMenuOpen, setDataMenuOpen] = useState(false)
  const dataMenuRef = useRef<HTMLDivElement>(null)
  const dataMenuBtnRef = useRef<HTMLButtonElement>(null)
  // Resizable + collapsible sidebar. `activeView` controls which panel is shown
  // in the secondary area next to the Activity Bar. `null` means the panel is
  // collapsed (only the icon rail is visible).
  const [sidebarWidth, setSidebarWidth] = useState(220)
  const sidebarWidthRef = useRef(220)
  const isResizing = useRef(false)
  const [activeView, setActiveView] = useState<ActivityView | null>('workspace')
  // Keep a ref to the last non-null view so Ctrl+B can restore it.
  const lastViewRef = useRef<ActivityView>('workspace')
  const sidebarVisible = activeView !== null
  const [editorTabs, setEditorTabs] = useState<Record<string, { workspaceId: string; script: WorkspaceScript }>>({})
  // Unsaved-changes flag per editor tab (reported by ScriptViewer), used to guard tab close.
  const [editorDirty, setEditorDirty] = useState<Record<string, boolean>>({})
  // The single "preview" (peek) tab, if any. Opening a file only takes a look: its tab renders italic
  // and the next file opened reuses the slot, so browsing a workspace does not litter the strip.
  // Editing, running, or double-clicking the tab promotes it to a kept tab.
  const [previewTabId, setPreviewTabId] = useState<string | null>(null)
  const keepTab = useCallback((id: string) => {
    setPreviewTabId(prev => (prev === id ? null : prev))
  }, [])
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('cc.sidebarWidth')
    if (saved) {
      const w = Math.max(180, Math.min(520, parseInt(saved, 10)))
      setSidebarWidth(w)
      sidebarWidthRef.current = w
    }
    // Default to 1 window on open, so we don't restore layoutMode from local storage here.
    // The workspace panel is intentionally never restored — it always starts hidden on launch.
    const savedView = localStorage.getItem('cc.activeView')
    if (savedView === 'workspace' || savedView === 'files') {
      setActiveView(savedView)
      lastViewRef.current = savedView
    } else if (savedView === 'connections') {
      // One-time migration from the removed Connections destination.
      setActiveView('workspace')
      lastViewRef.current = 'workspace'
      localStorage.setItem('cc.activeView', 'workspace')
    } else if (savedView === 'null') {
      setActiveView(null)
    }

    const handleNewSession = (e: Event) => {
      // The saved default may name a shell this machine no longer has (or never had — a backup from
      // another OS), so it is re-validated against the probed list rather than trusted.
      const shell = (e as CustomEvent).detail?.shell
        ?? pickShell(shellOptionsRef.current, appSettings.defaultShell)
      // The connection record comes from the host (see newSession.ts) — under Tauri the backend has to
      // register an unsaved shell before any pane can resolve it.
      void openNewSession(
        shell,
        (conn) => handleConnectRef.current(conn as Connection),
      ).catch(
        (err: unknown) => diag.error('[MainLayout] could not open a new session', err),
      )
    }
    const handleToggleSidebar = () => {
      setActiveView(prev => {
        if (prev !== null) {
          lastViewRef.current = prev
          localStorage.setItem('cc.activeView', 'null')
          return null
        }
        const restored = lastViewRef.current
        localStorage.setItem('cc.activeView', restored)
        return restored
      })
    }
    const handleCommandPalette = () => {
      setCommandPaletteOpen(true)
    }

    window.addEventListener('omniterm:new-session', handleNewSession)
    window.addEventListener('omniterm:toggle-sidebar', handleToggleSidebar)
    window.addEventListener('omniterm:command-palette', handleCommandPalette)

    return () => {
      window.removeEventListener('omniterm:new-session', handleNewSession)
      window.removeEventListener('omniterm:toggle-sidebar', handleToggleSidebar)
      window.removeEventListener('omniterm:command-palette', handleCommandPalette)
    }
  }, [])

  const handleResizeDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    const startX = e.clientX
    const startWidth = sidebarWidthRef.current

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(520, startWidth + ev.clientX - startX))
      setSidebarWidth(newWidth)
      sidebarWidthRef.current = newWidth
    }
    const onMouseUp = () => {
      isResizing.current = false
      localStorage.setItem('cc.sidebarWidth', String(sidebarWidthRef.current))
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])
  // Show / hide the secondary panel. Persisted so the choice survives restarts.
  // Called from the Activity Bar icon clicks.
  const handleViewChange = useCallback((view: ActivityView | null) => {
    if (view !== null) lastViewRef.current = view
    setActiveView(view)
    localStorage.setItem('cc.activeView', String(view))
  }, [])
  // Export modal state removed
  // About modal
  // settingsOpen is controlled externally via TitleBar → App → MainLayout prop
  const aboutOpen = settingsOpen
  const setAboutOpen = setSettingsOpen

  const [updateChecking, setUpdateChecking] = useState(false)
  const [installerChoiceOpen, setInstallerChoiceOpen] = useState(false)
  const [splitRatios, setSplitRatios, persistRatios] = useSplitRatios(appSettings, setAppSettings)

  // The shells this machine can actually start, probed once — an install does not appear mid-session.
  // Mirrored into a ref so the new-session listener can read the current list without re-subscribing.
  const [shellOptions, setShellOptions] = useState<ShellOption[]>([])
  const shellOptionsRef = useRef<ShellOption[]>([])
  // ── Load on mount ───────────────────────────────────────────────────────────

  useEffect(() => {
    void loadShellOptions().then(opts => {
      shellOptionsRef.current = opts
      setShellOptions(opts)
    })
  }, [])

  // Every workspace's saved connections, re-read whenever one is written. With no connection provider
  // installed each workspace simply reports none, so this settles to an empty list.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const workspaces = await window.omnitermAPI.workspace.list()
        const lists = await Promise.all(
          workspaces.map(ws => window.omnitermAPI.workspace.loadConnections(ws.id)),
        )
        if (!cancelled) setSavedConnections(lists.flat())
      } catch (error) {
        diag.error('[MainLayout] could not load workspace connections', error)
      }
    })()
    return () => { cancelled = true }
  }, [wsConnectionsRevision])
  // Close the data menu on outside click or Escape
  useEffect(() => {
    if (!dataMenuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDataMenuOpen(false) }
    const onClick = (e: MouseEvent) => {
      if (
        dataMenuRef.current && !dataMenuRef.current.contains(e.target as Node) &&
        dataMenuBtnRef.current && !dataMenuBtnRef.current.contains(e.target as Node)
      ) setDataMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [dataMenuOpen])
  // ── Update check handlers ──────────────────────────────────────────────────

  const checkForUpdates = async () => {
    setInstallerChoiceOpen(false)
    setUpdateChecking(true)
    try {
      setUpdateState(await window.omnitermAPI.updates.check())
    } catch (err) {
      await showAlert(`Could not check for updates: ${err instanceof Error ? err.message : String(err)}`, {
        title: 'Update Check Failed',
        tone: 'error',
      })
    }
    finally { setUpdateChecking(false) }
  }

  const handleDownloadPortable = async () => {
    if (!updateState?.latest) return
    const defaultName = `OmniTerm-Portable-${updateState.latest}.exe`
    const savePath = await window.omnitermAPI.updates.showSaveDialog(defaultName)
    if (!savePath) return
    try {
      setUpdateChecking(true)
      await window.omnitermAPI.updates.downloadPortable(savePath)
    } catch (err) {
      showAlert(`Download failed: ${err instanceof Error ? err.message : String(err)}`, { title: 'Download Error', tone: 'error' })
    } finally {
      setUpdateChecking(false)
    }
  }

  const handleDownloadInstaller = async (installNow: boolean) => {
    setInstallerChoiceOpen(false)
    try {
      setUpdateChecking(true)
      await window.omnitermAPI.updates.downloadInstaller(installNow)
    } catch (err) {
      showAlert(`Download failed: ${err instanceof Error ? err.message : String(err)}`, { title: 'Download Error', tone: 'error' })
    } finally {
      setUpdateChecking(false)
    }
  }
  // Skip the currently-detected latest release (one click, no manual typing).
  const skipThisVersion = async () => {
    if (updateState?.latest) setUpdateState(await window.omnitermAPI.updates.skip(updateState.latest))
  }

  const clearSkippedVersion = async () => {
    const s = await window.omnitermAPI.updates.skip(null)
    setUpdateState(s)
  }
  // ── Connection save ─────────────────────────────────────────────────────────
  //
  // Connections are workspace-scoped: they live in the workspace folder they belong to, so writing
  // one goes through `upsertWorkspaceConnection` and the panel reloads on the revision bump. The host
  // keeps no saved list of its own to update here.

  const handleSaveConnection = async (conn: Connection) => {
    const wsId = wsConnFormRef.current
    if (!wsId) return
    // Awaited, ref cleared first. The first version did neither: it returned before the write
    // landed, so nothing refreshed the panel and a rejected write was invisible.
    wsConnFormRef.current = null
    try {
      await upsertWorkspaceConnection(wsId, conn, !!connFormInitial)
      setWsConnectionsRevision(v => v + 1)
      // Keep the label on every open instance of this connection in step with a rename, renumbering
      // in place (LOCAL may have several: "WSL", "WSL (2)") so the suffixes do not collapse.
      setEphemeralConns(prev => prev.map(c => (c.id === conn.id ? { ...c, ...conn } : c)))
      setActiveTabs(prev => {
        let instanceIdx = 0
        return prev.map(t => {
          if (t.connId !== conn.id) return t
          instanceIdx++
          return { ...t, name: instanceIdx > 1 ? `${conn.name} (${instanceIdx})` : conn.name }
        })
      })
    } catch (error) {
      await showAlert(`Could not save the connection: ${error instanceof Error ? error.message : String(error)}`,
        { title: 'Workspace connection', tone: 'error' })
    }
  }
  // ── Tab / connect ───────────────────────────────────────────────────────────
  // ── Pane assignment ──────────────────────────────────────────────────────────
  // Show a session's tab: focus its visible pane, else fill the next empty visible pane.
  // With autoFillOnly (fresh connections) it registers as a tab when panes are full instead of
  // overwriting one; explicit clicks may replace the focused pane. Single view always takes over.
  const showTab = (id: string, opts?: { autoFillOnly?: boolean }) => {
    const visibleIdx = panes.findIndex((p, i) => p === id && i < layoutMode)
    if (visibleIdx !== -1) {
      setFocusedPane(visibleIdx)
      return
    }
    const emptyIdx = panes.findIndex((p, i) => p === null && i < layoutMode)
    if (emptyIdx !== -1) {
      setPanes(prev => prev.map((p, i) => (i === emptyIdx ? id : (p === id ? null : p))))
      setFocusedPane(emptyIdx)
      return
    }
    if (opts?.autoFillOnly && layoutMode > 1) {
      // No free pane: clear any hidden duplicate so the session exists only as a tab.
      setPanes(prev => prev.map(p => (p === id ? null : p)))
      return
    }
    setPanes(prev => prev.map((p, i) => (i === focusedPane ? id : (p === id ? null : p))))
  }
  // Null out every pane holding this id. In single view, keep the old behavior of
  // falling back to the last remaining tab when the focused (only) pane loses its
  // session; in split view the pane simply becomes an empty placeholder.
  const removeFromPanes = (id: string, remaining: { id: string }[]) => {
    setPanes(prev => {
      const wasFocused = prev[focusedPane] === id
      const next = prev.map(p => (p === id ? null : p))
      if (layoutMode === 1 && wasFocused) {
        next[focusedPane] = remaining[remaining.length - 1]?.id ?? null
      }
      return next
    })
  }

  const changeLayoutMode = useCallback((n: LayoutMode) => {
    // Shrinking with the focus out of the new range: swap the focused session into the
    // last visible slot so it survives (and the displaced one is parked hidden).
    if (focusedPane >= n) {
      setPanes(prev => {
        const next = [...prev]
        const tmp = next[n - 1]
        next[n - 1] = next[focusedPane]
        next[focusedPane] = tmp
        return next
      })
      setFocusedPane(n - 1)
    }

    // Auto-fill newly available panes when expanding layout
    if (n > layoutMode) {
      setPanes(prev => {
        const next = [...prev]
        const activeIds = activeTabs.map(t => t.id)
        const emptyIndices = []
        for (let i = 0; i < n; i++) {
          if (!next[i]) emptyIndices.push(i)
        }
        if (emptyIndices.length > 0) {
          const unassignedTabs = activeIds.filter(id => {
            for (let i = 0; i < n; i++) if (next[i] === id) return false
            return true
          })
          let tIdx = 0
          for (const i of emptyIndices) {
            if (tIdx < unassignedTabs.length) {
              next[i] = unassignedTabs[tIdx++]
            }
          }
        }
        return next
      })
    }

    setLayoutMode(n)
    localStorage.setItem('cc.layoutMode', String(n))
  }, [focusedPane, layoutMode, setLayoutMode, activeTabs])

  useEffect(() => {
    const handleLayoutChange = (e: Event) => {
      const mode = (e as CustomEvent).detail.mode as LayoutMode
      changeLayoutMode(mode)
    }
    window.addEventListener('omniterm:change-layout', handleLayoutChange)
    return () => window.removeEventListener('omniterm:change-layout', handleLayoutChange)
  }, [changeLayoutMode])
  // Assign a session to a specific pane (from the pane picker), clearing it from any
  // other slot it occupied (uniqueness). Focuses the pane.
  const assignToPane = (paneIndex: number, id: string) => {
    setPanes(prev => prev.map((p, i) => (i === paneIndex ? id : (p === id ? null : p))))
    setFocusedPane(paneIndex)
    setPanePicker(null)
  }

  const clearPane = (paneIndex: number) => {
    setPanes(prev => prev.map((p, i) => (i === paneIndex ? null : p)))
    setPanePicker(null)
  }
  // Drag-and-drop: swap the sessions of two panes (moves one into an empty pane too).
  const swapPanes = (a: number, b: number) => {
    if (a === b || Number.isNaN(a) || Number.isNaN(b)) return
    setPanes(prev => {
      const next = [...prev]
      const tmp = next[a]
      next[a] = next[b]
      next[b] = tmp
      return next
    })
    setFocusedPane(b)
  }

  const handleConnect = (conn: Connection) => {
    // Ensure ad-hoc connections (not in the saved tree) are tracked so connById can find them
    setEphemeralConns(prev => (prev.some(e => e.id === conn.id) ? prev : [...prev, conn]))

    // SSH/RDP: at most one instance — re-opening an already-open connection just focuses
    // it. LOCAL: every launch is a fresh, independent instance with its own session id, so
    // the same saved shell can run in several panes at once.
    if (conn.type === 'LOCAL') {
      const sessionId = mintSessionId(conn)
      const instanceCount = activeTabs.filter(t => t.connId === conn.id).length
      const name = instanceCount > 0 ? `${conn.name} (${instanceCount + 1})` : conn.name
      setActiveTabs(prev => [...prev, { id: sessionId, connId: conn.id, name }])
      showTab(sessionId, { autoFillOnly: true })
      return
    }
    const alreadyOpen = !!activeTabs.find(t => t.connId === conn.id)
    if (!alreadyOpen) {
      setActiveTabs(prev => [...prev, { id: conn.id, connId: conn.id, name: conn.name }])
    }
    // A freshly connected session auto-fills the next empty pane (or registers as a
    // tab when all panes are full). Re-opening an already-open session from the tree
    // is treated as an explicit focus request so it surfaces into the focused pane.
    showTab(conn.id, { autoFillOnly: !alreadyOpen })
  }
  /**
   * Show a script's run and its editor side by side: the terminal left, the file right. Only used when
   * both already exist for the same script — otherwise the layout is the user's and is left alone.
   */
  const pairRunWithEditor = (terminalId: string, editorId: string) => {
    setPanes(prev => {
      const next = prev.map(p => (p === terminalId || p === editorId ? null : p))
      next[0] = terminalId
      next[1] = editorId
      return next
    })
    setFocusedPane(0)
    if (appSettings.split2Style === 'rows') {
      setAppSettings({ ...appSettings, split2Style: 'columns' })
    }
    if (layoutMode < 2) changeLayoutMode(2)
  }

  const scriptRuns = useScriptRuns({
    isEditorOpen: (editorId) => !!editorTabs[editorId],
    isTabOpen: (tabId) => activeTabs.some(t => t.id === tabId),
    pair: pairRunWithEditor,
    // A refused launch (an unlaunchable kind, a script that left its workspace) must be visible.
    onError: (err) => void showAlert(err instanceof Error ? err.message : String(err),
      { title: 'Could not launch', tone: 'error' }),
  })

  // Open a workspace file as an editor tab in the main pane grid (deduped by path). A fresh open is a
  // peek: it claims the preview slot, and the file it displaces hands over its pane rather than
  // leaving a hole. Re-opening a file that is already a kept tab just focuses it.
  const openEditor = (workspaceId: string, script: WorkspaceScript) => {
    const id = editorTabId(script.path)
    const isNew = !activeTabs.some(t => t.id === id)
    const stale = previewTabId && previewTabId !== id ? previewTabId : null
    const stalePane = stale ? panes.findIndex((p, i) => p === stale && i < layoutMode) : -1
    if (stale) closeTabs([stale])
    setEditorTabs(prev => ({ ...prev, [id]: { workspaceId, script } }))
    setActiveTabs(prev => (prev.some(t => t.id === id) ? prev : [...prev, { id, connId: id, name: script.name }]))
    if (isNew) setPreviewTabId(id)
    if (stalePane !== -1) assignToPane(stalePane, id)
    else showTab(id, { autoFillOnly: true })
    // Already running? Show the two together instead of burying the run behind the editor.
    scriptRuns.pairWithRun(script.path, id)
  }
  // Cooperative launcher (nc-open): main asks us to open an ad-hoc local shell pane. Register its
  // params as an ephemeral connection, then open it through the normal connect path. A ref keeps the
  // subscription stable while always calling the latest handleConnect (which reads current panes).
  const handleConnectRef = useRef(handleConnect)
  handleConnectRef.current = handleConnect
  const noteShellOpenRef = useRef(scriptRuns.noteShellOpen)
  noteShellOpenRef.current = scriptRuns.noteShellOpen
  useEffect(() => {
    const off = window.omnitermAPI.shells.onOpen(conn => {
      const c = conn as Connection
      setEphemeralConns(prev => (prev.some(e => e.id === c.id) ? prev : [...prev, c]))
      handleConnectRef.current(c)
      noteShellOpenRef.current(c.id, !!c.localCommand)
    })
    // Tell main we can receive open requests now (renderer only mounts post-unlock), flushing any
    // launch that was queued while the app was locked / minimized / cold-starting.
    window.omnitermAPI.shells.ready()
    return off
  }, [])
  /** Sends the disconnect IPC for one running instance, dispatched by its connection's type. */
  const disconnectByType = useCallback((sessionId: string, connId: string) => {
    const conn = connById(connId)
    if (conn?.type === 'RDP') {
      window.omnitermAPI.connect.rdpDisconnect(sessionId)
    } else if (conn?.type === 'LOCAL') {
      window.omnitermAPI.connect.localDisconnect(sessionId)
    } else {
      window.omnitermAPI.connect.sshDisconnect(sessionId)
    }
  }, [connById])
  /** Clears every per-instance map entry (status/latency/detached/metrics/uptime) for these session ids. */
  const clearTabState = (sessionIds: string[]) => {
    if (sessionIds.length === 0) return
    const idSet = new Set(sessionIds)
    const prune = <T,>(prev: Record<string, T>): Record<string, T> => {
      let changed = false
      const next = { ...prev }
      for (const id of idSet) {
        if (id in next) { delete next[id]; changed = true }
      }
      return changed ? next : prev
    }
    setStatuses(prune)
    setActivity(prune)
    setLatencies(prune)
    setDetached(prune)
    setPoppedOut(prune)
    setResumeMode(prune)
    setMetrics(prune)
    setConnectedAt(prune)
  }
  /** Closes the given running instances: drops their tabs/panes, disconnects, clears state. */
  const closeTabs = (sessionIds: string[], skipConfirm = false) => {
    if (sessionIds.length === 0) return
    
    if (!skipConfirm && !skipCloseConfirmRef.current) {
      const needsConfirm = sessionIds.some(id => {
        // Editor tabs own no backend session, so they never trigger the terminal-close
        // confirm — their unsaved-changes guard is handled in closeTab instead.
        if (editorTabs[id]) return false
        const s = connStatuses[id] || 'closed'
        return s === 'connected' || s === 'connecting'
      })
      if (needsConfirm) {
        setPendingCloseTabIds(sessionIds)
        return
      }
    }

    const idSet = new Set(sessionIds)
    const closing = activeTabs.filter(t => idSet.has(t.id))
    const remaining = activeTabs.filter(t => !idSet.has(t.id))
    setActiveTabs(remaining)
    if (previewTabId && idSet.has(previewTabId)) setPreviewTabId(null)
    for (const t of closing) {
      removeFromPanes(t.id, remaining)
      // Popped-out: destroy the detached window + release its buffer so nothing is orphaned.
      if (poppedOut[t.id] && window.omnitermAPI.terminalWindow) window.omnitermAPI.terminalWindow.release(t.id)
      // Editor tabs own no backend session — just drop their state; others disconnect.
      if (editorTabs[t.id]) {
        setEditorTabs(prev => { const n = { ...prev }; delete n[t.id]; return n })
        setEditorDirty(prev => { const n = { ...prev }; delete n[t.id]; return n })
      }
      else disconnectByType(t.id, t.connId)
    }
    clearTabState(sessionIds)
    // Release ad-hoc launcher connections whose last tab just closed (drop renderer state and
    // let main forget the in-memory params).
    const goneConnIds = new Set(
      closing.map(t => t.connId).filter(cid => !remaining.some(t => t.connId === cid)),
    )
    const releasing = ephemeralConns.filter(e => goneConnIds.has(e.id))
    if (releasing.length) {
      setEphemeralConns(prev => prev.filter(e => !goneConnIds.has(e.id)))
      for (const e of releasing) window.omnitermAPI.shells.release(e.id)
    }
  }

  const closeTab = (sessionId: string) => {
    // A dirty editor tab prompts to discard first; a clean one (read or unmodified edit)
    // closes immediately with no confirm.
    if (editorTabs[sessionId] && editorDirty[sessionId]) {
      void showConfirm('Discard unsaved changes?', {
        title: 'Unsaved Changes', confirmLabel: 'Discard', cancelLabel: 'Keep Editing', tone: 'warning',
      }).then(ok => { if (ok) closeTabs([sessionId]) })
      return
    }
    closeTabs([sessionId])
  }
  // Disconnect one running instance but keep its tab open (view shows final output).
  const disconnectSession = (sessionId: string) => {
    const tab = activeTabs.find(t => t.id === sessionId)
    disconnectByType(sessionId, tab?.connId ?? sessionId)
    // The 'closed' event from the backend will flip the status to 'closed'.
  }
  // Re-establish a closed/errored session by remounting its TerminalView.
  const reconnectSession = (id: string) => {
    setStatus(id, 'connecting')
    // A reconnect starts a fresh session, so drop any latched attach/replay mode from an
    // earlier pop-out — otherwise the remount would try to resume a session that has ended.
    setResumeMode(prev => (prev[id] ? { ...prev, [id]: false } : prev))
    setReconnectKeys(prev => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
  }
  // ── Sidebar panel: workspace tree vs SFTP file browser ─────────────────────
  // The Files panel browses the ACTIVE tab's host — only meaningful for a
  // connected SSH session. Resolved through `connById`, which is the only record of what a session
  // was launched from now that the renderer holds no saved connection list.
  const activeSshId =
    activeTabId &&
    connById(activeTabId)?.type === 'SSH' &&
    statuses[activeTabId] === 'connected'
      ? activeTabId
      : null
  const activeSshName = activeSshId ? connById(activeSshId)?.name ?? '' : ''
  // Fall back to the workspace tree when the active SSH session goes away.
  useEffect(() => {
    if (activeView === 'files' && !activeSshId) {
      setActiveView('workspace')
      localStorage.setItem('cc.activeView', 'workspace')
    }
  }, [activeView, activeSshId])
  // ── Open connection ids (for the Sidebar's status dots) ─────────────────────
  // A saved connection can have several running instances (LOCAL), each with its own
  // status. openIds/connStatuses aggregate per connId: open if ANY instance is open;
  // the displayed status is the "best" one (connected beats connecting beats error beats
  // closed) so the dot reflects "is anything live", not an arbitrary single instance.

  const STATUS_RANK: Record<SessionStatus, number> = { connected: 3, connecting: 2, error: 1, closed: 0 }
  const connStatuses: Record<string, SessionStatus> = {}
  for (const t of activeTabs) {
    const s = statuses[t.id] ?? 'connecting'
    const prev = connStatuses[t.connId]
    if (!prev || STATUS_RANK[s] > STATUS_RANK[prev]) connStatuses[t.connId] = s
  }
  // Hide native RDP windows not only for modals, but also while a pane picker dropdown
  // is open or a pane drag is in progress — both rely on DOM chrome that the always-on-top
  // mstsc window would otherwise cover.
  const isOverlayOpen = connFormOpen || settingsOpen || dataMenuOpen || panePicker !== null || dragPane !== null

  useEffect(() => {
    window.omnitermAPI.connect.rdpSetOverlay(isOverlayOpen)
  }, [isOverlayOpen])
  // Keyboard focus follows the active pane. TerminalView focuses itself when it first becomes visible,
  // which is not enough on its own: a pane opened while another already had focus (a workspace script
  // launched from the sidebar or from an editor's Run button, a tab switch, a pane swap) would render
  // with a cursor but receive no keys, so a script waiting on `pause` could not be answered. The event
  // is addressed to one session id, so an editor pane's own focus is never taken from it.
  useEffect(() => {
    if (!activeTabId || isOverlayOpen) return
    focusTerminal(activeTabId)
  }, [activeTabId, isOverlayOpen])
  // Close the pane session-picker on outside click or Escape.
  useEffect(() => {
    if (panePicker === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanePicker(null) }
    const onClick = (e: MouseEvent) => {
      if (panePickerRef.current && !panePickerRef.current.contains(e.target as Node)) setPanePicker(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [panePicker])

  useEffect(() => {
    const handleCloseTabEvent = () => {
      const activeTabId = panes[focusedPane]
      if (activeTabId) {
        // Defer the close action so the keydown event can finish propagating
        // and Chromium respects e.preventDefault(). If the target element
        // is unmounted synchronously, native shortcuts (like Ctrl+W) still fire!
        setTimeout(() => closeTab(activeTabId), 0)
      }
    }
    window.addEventListener('omniterm:close-tab', handleCloseTabEvent)
    return () => window.removeEventListener('omniterm:close-tab', handleCloseTabEvent)
  }, [panes, focusedPane, closeTab])

  // One decision, three buttons: the footer (active tab), every pane header, and — over in
  // DetachedTerminalWindow — the popped-out window's own title bar. See useDetachControl.ts.
  const detachControl = useDetachControl({
    tabs: activeTabs, connById, isEditorTab: (id) => !!editorTabs[id],
    statuses, rdpDetached: detached, poppedOut, canDetachWindow,
    onRdpToggle: toggleDetach, onPopOut: popOutTerminal, onAttach: reattachTerminal,
  })

  // ── Pane chrome (split view) ─────────────────────────────────────────────────
  const renderPaneHeader = (paneIndex: number, conn: Connection | null) => (
    <PaneHeader
      paneIndex={paneIndex} conn={conn} focused={paneIndex === focusedPane}
      sessionId={panes[paneIndex]} tabs={activeTabs} panes={panes} layoutMode={layoutMode}
      statuses={statuses} connType={(connId) => connById(connId)?.type}
      pickerOpen={panePicker === paneIndex} pickerRef={panePickerRef}
      detach={detachControl.stateOf(panes[paneIndex])}
      onToggleDetach={() => detachControl.toggle(panes[paneIndex])}
      onFocus={() => setFocusedPane(paneIndex)}
      onDragStart={() => setDragPane(paneIndex)}
      onDragEnd={() => setDragPane(null)}
      onTogglePicker={() => setPanePicker(p => (p === paneIndex ? null : paneIndex))}
      onAssign={(tabId) => assignToPane(paneIndex, tabId)}
      onClear={() => clearPane(paneIndex)}
    />
  )
  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full w-full flex bg-theme-bg overflow-hidden">
      {/* ── Activity Bar (icon rail — always visible) ────────────────── */}
      <ActivityBar
        activeView={activeView}
        filesEnabled={!!activeSshId && connectionCapabilities?.sftp === true}
        onViewChange={handleViewChange}
        onSettingsClick={() => setSettingsOpen(true)}
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
              onConnectWorkspaceConnection={handleConnect}
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
        <div className="h-[40px] px-2.5 flex items-center gap-2 border-b border-[var(--theme-border)] flex-shrink-0">

          {/* Tab list — flex-1 so it fills all available space before the picker */}
          <div className="flex-1 min-w-0 overflow-hidden">
          {activeTabs.length > 0 && (
            <SessionTabs
              tabs={activeTabs} panes={panes} layoutMode={layoutMode} focusedPane={focusedPane}
              statuses={statuses} activity={activity}
              isEditor={(id) => !!editorTabs[id]}
              isPreview={(id) => previewTabId === id}
              isEphemeral={(connId) => ephemeralConns.some(e => e.id === connId)}
              connType={(connId) => connById(connId)?.type}
              onSelect={showTab}
              onPromote={keepTab}
              onClose={closeTab}
              onContextMenu={(e, id) => { e.preventDefault(); setTabMenu({ x: e.clientX, y: e.clientY, tabId: id }) }}
              onNewSession={() => window.dispatchEvent(new Event('omniterm:new-session'))}
              onPickShell={(rect) => setShellMenu({ x: rect.left, y: rect.bottom + 4 })}
            />
          )}
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
            ] as const).map(([m, Icon, label]) => (
              <button
                key={m}
                type="button"
                title={
                  m === 3 && layoutMode === 3 ? `${label} (${appSettings.split3Style || 'left'}) - Click to cycle`
                  : m === 2 && layoutMode === 2 ? `${label} (${appSettings.split2Style || 'columns'}) - Click to toggle`
                  : label
                }
                onClick={() => {
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
                className={`relative inline-flex items-center justify-center w-6 h-6 transition-colors hover:bg-white/5 ${
                  layoutMode === m
                    ? 'bg-white/10 text-[var(--theme-accent)] font-bold'
                    : 'text-inherit opacity-50 hover:opacity-100'
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
            ))}
          </div>

        </div>

        {/* Active-session control bar — rendered as a FOOTER (order-last) so the
            embedded RDP desktop filling the content area can never cover the controls. */}
        {activeTabId && (() => {
          const activeConnId = activeTabs.find(t => t.id === activeTabId)?.connId
          const conn = connById(activeConnId)
          if (!conn) return null
          const status = statuses[activeTabId] ?? 'connecting'
          // Latency source differs by type: RDP has its own TCP probe; SSH carries it in metrics.
          const resolvedLatency = conn.type === 'RDP'
            ? (latencies[activeTabId] ?? null)
            : (metrics[activeTabId]?.latency ?? null)
          return (
            <div className="order-last h-7 flex-shrink-0 bg-theme-sidebar border-t border-theme-border flex items-center gap-2 px-2.5 select-none">
              {/* Which pane the footer is describing, in that pane's own shape + hue. */}
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
                <div className="flex items-center gap-1 mr-1 rounded px-1 border border-theme-border/50 bg-black/10">
                  <button type="button" onClick={() => updateFontSize(-1)} className="w-4 h-4 flex items-center justify-center text-theme-dim hover:text-theme-accent transition-colors" title="Decrease font size">-</button>
                  <span className="w-4 text-center font-mono text-[9px] text-theme-fg">{appSettings.fontSize || 14}</span>
                  <button type="button" onClick={() => updateFontSize(1)} className="w-4 h-4 flex items-center justify-center text-theme-dim hover:text-theme-accent transition-colors" title="Increase font size">+</button>
                </div>
                {/* Detach / attach for the active tab. The same control also sits on every pane
                    header, so a background dock does not have to be activated first. */}
                {(() => {
                  const action = detachControl.stateOf(activeTabId)
                  if (!action) return null
                  // RDP's "detach" is native fullscreen, which reads as maximize, not as pop-out.
                  const Icon = action === 'attach' ? Minimize2 : conn.type === 'RDP' ? Maximize2 : ExternalLink
                  const title = conn.type === 'RDP' && action === 'detach'
                    ? 'Fullscreen (pop out)'
                    : detachTitle(action, 'footer')
                  return (
                    <button
                      onClick={() => detachControl.toggle(activeTabId)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded border border-theme-border text-theme-fg hover:border-theme-accent hover:text-theme-accent transition-colors"
                      title={title}
                      aria-label={title}
                    >
                      <Icon className="w-3 h-3" />
                    </button>
                  )
                })()}
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
            </div>
          )
        })()}

        {/* Session content. A small top gap keeps the embedded RDP desktop from butting up
            against (and visually obscuring) the Sessions header / tabs above it.

            Split view: a frame layer (borders + mini pane headers + empty-slot hints) is
            drawn first, then each open session is positioned into its pane on top of the
            frame. Sessions not in any visible pane stay mounted but hidden. In single view
            (layoutMode === 1) no frames render and the session fills the area — identical
            to the pre-split behavior. */}
        <div className="flex-1 relative min-h-0 mt-1">
          {activeTabs.length === 0 ? (
            <WaitingPane
              dark={!!appSettings.darkMode}
              onNewSession={() => window.dispatchEvent(new Event('omniterm:new-session'))}
              onPickShell={(rect) => setShellMenu({ x: rect.left, y: rect.bottom + 4 })}
            />
          ) : (
            <>
              {/* Empty-pane frames (split view only). Filled panes draw their own chrome in
                  the session wrapper below (so the header sits above the native RDP window).
                  Each frame is a drop target and hosts a quick-pick to fill the slot. */}
              {layoutMode > 1 && Array.from({ length: layoutMode }).map((_, i) => {
                if (panes[i]) return null
                const isFocused = i === focusedPane
                const isDropTarget = dragPane !== null && dragPane !== i
                return (
                  <div
                    key={`frame-${i}`}
                    className="absolute p-0.5"
                    style={paneRect(i, layoutMode, appSettings.split3Style, appSettings.split2Style, splitRatios)}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                    onDrop={(e) => { e.preventDefault(); swapPanes(Number(e.dataTransfer.getData('text/plain')), i); setDragPane(null) }}
                  >
                    <div
                      onMouseDown={() => setFocusedPane(i)}
                      // The focused pane is outlined in its OWN hue, so it matches the tab that lives
                      // in it rather than the one global accent.
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
                          openSessionCount={activeTabs.length}
                          onNewSession={() => { setFocusedPane(i); window.dispatchEvent(new Event('omniterm:new-session')) }}
                          onPickShell={(rect) => { setFocusedPane(i); setShellMenu({ x: rect.left, y: rect.bottom + 4 }) }}
                          onChooseSession={() => setPanePicker(i)}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Draggable boundaries. Above the frames, below the pane content. */}
              <PaneResizers mode={layoutMode} ratios={splitRatios}
                split3Style={appSettings.split3Style ?? 'left'} split2Style={appSettings.split2Style ?? 'columns'}
                onChange={setSplitRatios} onCommit={persistRatios} />

              {/* Session views — one per open tab, positioned into its pane (or hidden). */}
              {activeTabs.map(tab => {
                const conn = connById(tab.connId)
                const paneIdx = panes.findIndex((p, i) => p === tab.id && i < layoutMode)
                const visible = paneIdx !== -1
                const split = visible && layoutMode > 1
                const isFocused = paneIdx === focusedPane
                const isDropTarget = split && dragPane !== null && dragPane !== paneIdx
                const style: React.CSSProperties = visible && layoutMode > 1
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
                    paneEpoch={`${layoutMode}:${paneIdx}`}
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
                    onStatus={(s: SessionStatus) => setStatus(tab.id, s)}
                    onMetrics={(m) => setMetric(tab.id, m)}
                    onActivity={(busy) => setBusy(tab.id, busy)}
                    // A run-to-completion pane has nothing left once its shell exits, so it takes its
                    // own tab with it (see sessionExit.ts). skipConfirm: the session is already gone.
                    onExit={(code) => { if (closesOnExit(conn, code)) closeTabs([tab.id], true) }}
                    theme={appSettings.darkMode ? currentTheme.terminal.dark : currentTheme.terminal.light}
                    fontSize={appSettings.fontSize} smartColors={appSettings.smartColors}
                    shortcuts={appSettings.shortcuts}
                    fontFamilyMono={appSettings.darkMode ? currentTheme.ui.dark.fontFamilyMono : currentTheme.ui.light.fontFamilyMono}
                  />
                )
                return (
                  <div
                    key={tab.id}
                    onMouseDownCapture={() => { if (visible) setFocusedPane(paneIdx) }}
                    onDragOver={split ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } : undefined}
                    onDrop={split ? (e) => { e.preventDefault(); swapPanes(Number(e.dataTransfer.getData('text/plain')), paneIdx); setDragPane(null) } : undefined}
                    className={`absolute ${visible ? '' : 'hidden'} ${split ? 'p-0.5' : ''}`}
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
                        {statuses[tab.id] === 'connecting' && !poppedOut[tab.id] && <ConnectingOverlay dark={appSettings.darkMode} />}
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



      {/* ── Settings modal (About + Backup + Updates + Shortcuts) ─────────── */}
      {aboutOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget) setAboutOpen(false) }}
        >
          <div className="w-full max-w-2xl bg-theme-popup rounded-2xl border border-theme-border shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <span className="text-xs font-bold text-theme-fg tracking-widest uppercase">Settings</span>
              <button onClick={() => setAboutOpen(false)} className="text-theme-dim hover:text-theme-error transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Two-column container */}
            <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-[#414868] h-[550px] max-h-[80vh]">
              {/* Left Column: General Settings, Backup, and Updates */}
              <div className="flex-1 flex flex-col min-w-0 overflow-y-auto custom-scrollbar">
                <PluginManager
                  activeSessionCount={activeTabs.length}
                  onProviderStatusChanged={(active) => {
                    setHasConnectionProvider(active)
                    window.omnitermAPI.plugin.connectionCapabilities()
                      .then(setConnectionCapabilities)
                      .catch(diag.error)
                  }}
                  showAlert={showAlert}
                  showConfirm={showConfirm}
                />

                {/* General Settings */}
                <div className="px-4 py-2.5 border-t border-theme-border">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase font-bold tracking-widest text-theme-dim">General</p>
                    {/* Development only. A release or portable build writes no log (see
                        src-tauri/src/app_utils.rs), so this would open an empty folder at best. */}
                    {import.meta.env.DEV && (
                      <button type="button"
                        onClick={() => { setAboutOpen(false); window.omnitermAPI.app.revealLog() }}
                        className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-theme-fg hover:text-theme-warning bg-theme-bg border border-theme-border rounded transition-colors"
                        title="Open application log">
                        <FileText className="w-3 h-3 text-theme-warning" />Open log
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-theme-fg uppercase font-bold tracking-widest ml-0.5">Default Terminal</label>
                    <div className="relative">
                      <select
                        value={pickShell(shellOptions, appSettings.defaultShell)}
                        onChange={(e) => {
                          const next = { ...appSettings, defaultShell: e.target.value }
                          setAppSettings(next)
                          window.omnitermAPI.settings.save(next)
                        }}
                        className="w-full bg-theme-bg border border-theme-border rounded-lg py-2 pl-3 pr-8 text-xs text-white appearance-none focus:outline-none focus:border-theme-accent transition-colors cursor-pointer"
                      >
                        {shellOptions.map(opt => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-theme-dim">
                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Branding */}
                <div className="flex flex-col items-center gap-2 px-4 pb-1 pt-2.5 border-t border-theme-border">
                  <div className="w-12 h-12 rounded-2xl overflow-hidden shadow-lg shadow-[#7aa2f7]/20">
                    <img src={appLogo} alt="OmniTerm" className="w-full h-full object-cover" />
                  </div>
                  <div className="text-center">
                    <h2 className="text-sm font-bold text-[var(--theme-fg)] tracking-tight">OmniTerm</h2>
                  </div>
                  <span className="text-[10px] text-[#414868] bg-theme-bg px-2 py-0.5 rounded-full border border-theme-border">
                    v{updateState?.current ?? '…'}
                  </span>
                </div>

                {/* Updates. This used to sit behind an "Advanced" tab alongside the encrypted vault
                    backup, which only works with a connection-manager plugin — the backup moved next
                    to the plugin it depends on, and checking for updates is plain app settings. */}
                <UpdateSettings
                  appSettings={appSettings}
                  setAppSettings={setAppSettings}
                  updateState={updateState}
                  updateChecking={updateChecking}
                  installerChoiceOpen={installerChoiceOpen}
                  setInstallerChoiceOpen={setInstallerChoiceOpen}
                  checkForUpdates={checkForUpdates}
                  skipThisVersion={skipThisVersion}
                  clearSkippedVersion={clearSkippedVersion}
                  handleDownloadPortable={handleDownloadPortable}
                  handleDownloadInstaller={handleDownloadInstaller}
                />

                <div className="px-4 py-3 border-t border-theme-border">
                  <p className="text-[11px] text-theme-dim leading-relaxed">
                    {hasConnectionProvider
                      ? 'Local terminals and optional remote connections. Nothing leaves this machine unless you connect it somewhere.'
                      : 'A plugin-free local terminal and project workspace. Install and select a connection provider to add SSH or RDP.'}
                  </p>
                </div>
              </div>

              {/* Right Column: Keyboard Shortcuts */}
              <div className="flex-1 flex flex-col min-w-0 md:border-l border-theme-border">
                <div className="px-4 py-3 border-t border-theme-border">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-theme-dim mb-2">Keyboard Shortcuts</p>
                  <p className="text-[11px] text-theme-fg leading-relaxed">
                    Click a binding and press any keys to record a new shortcut. (Modifiers will combine automatically).
                  </p>
                </div>

                <div className="px-4 py-3 border-t border-theme-border flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 pr-2 min-h-0">
                  {Object.entries(shortcutLabels).map(([key, label]) => {
                    const currentBinding = (appSettings.shortcuts as any)?.[key] || (DEFAULT_SHORTCUTS as any)?.[key] || 'None'
                    const isRecording = recordingAction === key

                    return (
                      <div key={key} className="flex items-center justify-between py-1.5 border-b border-theme-border/30">
                        <span className="text-xs text-theme-fg font-medium truncate pr-2">{label}</span>
                        <button
                          type="button"
                          onClick={() => setRecordingAction(isRecording ? null : key)}
                          className={`min-w-[90px] max-w-[140px] truncate text-center text-[10px] font-mono font-bold py-1.5 px-2 rounded-lg border transition-all ${
                            isRecording
                              ? 'bg-[var(--theme-accent)] text-theme-accent-fg border-[var(--theme-accent)] animate-pulse'
                              : 'bg-theme-bg border-theme-border text-[var(--theme-accent)] hover:border-[var(--theme-accent)] hover:bg-white/5'
                          }`}
                        >
                          {isRecording ? 'Record…' : currentBinding}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}



      {tabMenu && (
        <div 
          className="fixed inset-0 z-50"
          onClick={() => setTabMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setTabMenu(null) }}
        >
          <div 
            className="absolute bg-theme-popup border border-theme-border rounded-lg shadow-xl py-1 min-w-[160px] text-xs font-medium"
            style={{ left: tabMenu.x, top: tabMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <CtxItem label="Close" icon={<X className="w-3.5 h-3.5" />} color="text-theme-fg" onClick={() => { closeTab(tabMenu.tabId); setTabMenu(null) }} />
            <CtxItem label="Close Others" icon={<XCircle className="w-3.5 h-3.5" />} color="text-theme-fg" onClick={() => {
              closeTabs(activeTabs.filter(t => t.id !== tabMenu.tabId).map(t => t.id))
              setTabMenu(null)
            }} />
            <CtxItem label="Close to the Left" icon={<ArrowLeft className="w-3.5 h-3.5" />} color="text-theme-fg" onClick={() => {
              const idx = activeTabs.findIndex(t => t.id === tabMenu.tabId)
              if (idx > 0) closeTabs(activeTabs.slice(0, idx).map(t => t.id))
              setTabMenu(null)
            }} />
            <CtxItem label="Close to the Right" icon={<ArrowRight className="w-3.5 h-3.5" />} color="text-theme-fg" onClick={() => {
              const idx = activeTabs.findIndex(t => t.id === tabMenu.tabId)
              if (idx !== -1 && idx < activeTabs.length - 1) closeTabs(activeTabs.slice(idx + 1).map(t => t.id))
              setTabMenu(null)
            }} />
            <div className="h-px bg-theme-border my-1 mx-2" />
            <CtxItem label="Close All" icon={<Trash2 className="w-3.5 h-3.5" />} color="text-theme-error" onClick={() => {
              closeTabs(activeTabs.map(t => t.id))
              setTabMenu(null)
            }} />
          </div>
        </div>
      )}

      {shellMenu && (
        <div 
          className="fixed inset-0 z-50"
          onClick={() => setShellMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setShellMenu(null) }}
        >
          <div 
            className="absolute bg-theme-popup border border-theme-border rounded-lg shadow-xl py-1 min-w-[160px] text-xs font-medium"
            style={{ left: shellMenu.x, top: shellMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Only shells the backend can really start. The old hardcoded list included "Git Bash",
                which is not a LocalShell — clicking it failed with nothing shown to the user. */}
            {shellOptions.map(opt => (
              <CtxItem key={opt.id} label={opt.label} icon={<Terminal className="w-3.5 h-3.5" />} color="text-theme-fg" onClick={() => { window.dispatchEvent(new CustomEvent('omniterm:new-session', { detail: { shell: opt.id } })); setShellMenu(null) }} />
            ))}
          </div>
        </div>
      )}

      {pendingCloseTabIds && (
        <CloseConfirmModal 
          isMultiple={pendingCloseTabIds.length > 1}
          onCancel={() => setPendingCloseTabIds(null)}
          onConfirm={(applyToAll) => {
            if (applyToAll) skipCloseConfirmRef.current = true
            closeTabs(pendingCloseTabIds, true)
            setPendingCloseTabIds(null)
          }}
        />
      )}

      {/* ── Custom themed dialog host (replaces window.alert / window.confirm) ── */}
      <DialogHost dialogState={dialogState} />
      
      <CommandPalette 
        isOpen={commandPaletteOpen} 
        onClose={() => setCommandPaletteOpen(false)} 
        connections={savedConnections}
        onConnect={(conn) => handleConnect(conn)} 
      />
    </div>
  )
}

export default MainLayout
