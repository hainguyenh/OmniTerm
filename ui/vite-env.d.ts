/// <reference types="vite/client" />

// Tauri runtime detection
declare global {
  interface Window {
    __TAURI__?: Record<string, unknown>
  }
}

interface ShortcutBindings {
  zoomIn: string
  zoomOut: string
  zoomReset: string
  newSession: string
  newFolder: string
  openSettings: string
  toggleThemeMode: string
  layout1: string
  layout2: string
  layout3: string
  layout4: string
  layout5: string
  layout6: string
  layout7: string
  layout8: string
  toggleSidebar: string
  commandPalette: string
  closeTab: string
}

/**
 * Per-terminal appearance overrides. Absent fields fall back to the app-wide default (or the
 * connection's persisted overrides, for in-session divergences). `fontSize` clamps 8–48, `themeId`
 * is any id from `themes.list`.
 */
interface TerminalAppearance {
  fontSize?: number
  themeId?: string
}

interface AppSettings {
  themeId: string
  fontSize: number
  smartColors: boolean
  checkUpdatesOnStartup: boolean
  darkMode: boolean
  /** Per-connection appearance defaults (font size + theme), keyed by connection id. */
  perConn?: Record<string, TerminalAppearance>
  /** Any id from `shells.list` — validated against that list before use, never assumed. */
  defaultShell?: string
  lastKnownLatest?: string
  lastCheckAt?: number
  skippedVersion?: string | null
  shortcuts?: ShortcutBindings
  split3Style?: 'left' | 'right' | 'top'
  /** Split-2 orientation: side-by-side columns (default) or stacked top/bottom rows. */
  split2Style?: 'columns' | 'rows'
  /** Where the draggable pane boundaries sit, as fractions for all multi-pane layouts. */
  splitRatios?: { main: number; cross: number; columns?: number[]; rows?: number[] }
  /** Max size (MB) the built-in viewer/editor will open or save; the backend clamps the range. */
  maxOpenFileMb?: number
  /** Extensions the user chose to hide from the viewer, on top of the fixed system deny-list. */
  excludedViewableExts?: string[]
  /** App-wide UI zoom (0.5–2.0), so it survives restart and every window converges on one factor. */
  zoomFactor?: number
  blurInactiveWindow?: number
  blurInactiveDock?: boolean
  blurEnabled?: boolean
  /**
   * What Shift+Enter / Ctrl+Enter send in a terminal: 'esc-cr' (ESC+CR, what AI agents expect), 'lf'
   * (a literal newline) or 'off' (leave it to xterm, which collapses both to a plain Enter).
   */
  shiftEnter?: 'esc-cr' | 'lf' | 'off'
  ctrlEnter?: 'esc-cr' | 'lf' | 'off'
}

interface SessionMetrics {
  latency: number | null      // ms
  cpu: number | null          // percent 0-100
  memUsed: number | null      // bytes
  memTotal: number | null     // bytes
  diskUsedPct: number | null  // percent 0-100
  ts: number
}

interface PluginDescriptor {
  id: string
  name: string
  description?: string
  version: string
  apiVersion: number
  hostVersion: string
  permissions: Array<'connections' | 'auth' | 'renderer' | 'openExternal' | 'clipboard' | 'workspace'>
  source: 'bundled' | 'user'
  enabled: boolean
  status: 'disabled' | 'loaded' | 'error' | 'incompatible'
  error?: string
  activeConnectionProvider: boolean
  selectedConnectionProvider: boolean
  activeAuthProvider: boolean
  activeInvokeHandler: boolean
}

interface ConnectionProviderCapabilities {
  protocols: Array<'SSH' | 'RDP'>
  credentialPolicy: 'prompt-every-time'
  scopes: Array<'personal' | 'workspace'>
  sftp: boolean
  importExport: boolean
}

/** Update-checker state pushed from main via 'updates:state'. */
interface UpdateState {
  current: string
  latest: string | null
  latestTag: string | null
  latestName: string
  notes: string
  htmlUrl: string
  publishedAt: string | null
  updateAvailable: boolean
  skippedVersion: string | null
  lastCheckAt: number | null
  error: string | null
  checking: boolean
  isPortable: boolean
  portableAssetUrl: string | null
  installerAssetUrl: string | null
  downloadProgress: number | null
  downloadStatus: string | null
  hasNewerVersion: boolean
}

type AlwaysAwakeMode = 'always' | 'activeOnly'

interface AlwaysAwakeStatus {
  enabled: boolean
  mode: AlwaysAwakeMode
  expiresAtMs: number
  activeSessionCount: number
  keepingAwake: boolean
  supported: boolean
  error: string | null
}

interface Window {
  omnitermAPI: {
    connections: {
      load: () => Promise<{ folders: any[]; connections: Array<{ id: string; name: string; type: 'SSH' | 'RDP' | 'LOCAL'; host: string; port: string; user: string; passwordHelpUrl?: string; parentId?: string; redirectDrives?: boolean; shell?: 'wsl' | 'powershell' | 'cmd'; localArgs?: string; localCwd?: string; localCommand?: string; localKeepOpen?: boolean }> }>
      save: (data: any) => Promise<void>
    }
    plugin: {
      available: () => Promise<boolean>
      list: () => Promise<PluginDescriptor[]>
      setEnabled: (id: string, enabled: boolean) => Promise<PluginDescriptor>
      selectConnectionProvider: (id: string | null) => Promise<PluginDescriptor[]>
      connectionCapabilities: () => Promise<import('@omniterm/contract').ConnectionProviderCapabilities | null>
      invoke: (method: string, ...args: any[]) => Promise<any>
      authGate: () => Promise<boolean>
      installPackage: () => Promise<null | { installed: boolean; id: string; name: string; version: string; restartRequired: boolean }>
      remove: (id: string) => Promise<boolean>
      restartApp: () => Promise<void>
    }
    connect: {
      rdp: (id: string) => Promise<{ ok: boolean; error?: string }>
      rdpDisconnect: (id: string) => void
      rdpSetBounds: (id: string, bounds: { x: number; y: number; width: number; height: number; dpr: number }) => void
      rdpSetVisible: (id: string, visible: boolean) => void
      rdpSetOverlay: (active: boolean) => void
      rdpSetDetached: (id: string, detached: boolean) => void
      rdpResetTrust: (host: string, port?: string) => Promise<void>
      onRDPDetachState: (cb: (id: string, detached: boolean) => void) => () => void
      overlayInit: () => Promise<{ id: string; name: string } | null>
      onRDPLatency: (id: string, cb: (ms: number | null) => void) => () => void
      onRDPReady: (id: string, cb: () => void) => () => void
      onRDPError: (id: string, cb: (err: string) => void) => () => void
      onRDPClosed: (id: string, cb: () => void) => () => void
      ssh: (id: string, darkMode?: boolean) => void
      sshDisconnect: (id: string) => void
      sshInput: (id: string, data: string) => void
      sshResize: (id: string, size: { cols: number, rows: number }) => void
      onSSHReady: (id: string, cb: () => void) => () => void
      onSSHData: (id: string, cb: (data: Uint8Array) => void) => () => void
      onSSHError: (id: string, cb: (err: string) => void) => () => void
      onSSHClosed: (id: string, cb: () => void) => () => void
      onSessionMetrics: (id: string, cb: (m: SessionMetrics) => void) => () => void
      // ── LOCAL (ConPTY) ──────────────────────────────────────────────────────
      // sessionId is this instance's unique key (IPC channels + PTY); connId is the saved
      // connection to load settings from — they diverge for a second+ instance of the same
      // LOCAL connection.
      local: (sessionId: string, connId: string, shell?: string, darkMode?: boolean) => void
      localDisconnect: (id: string) => void
      localInput: (id: string, data: string) => void
      localResize: (id: string, size: { cols: number, rows: number }) => void
      onLocalReady: (id: string, cb: (label?: string) => void) => () => void
      onLocalData: (id: string, cb: (data: Uint8Array) => void) => () => void
      onLocalError: (id: string, cb: (err: string) => void) => () => void
      // The shell's exit code. Absent under Electron, whose closed event carries no status.
      onLocalClosed: (id: string, cb: (code?: number) => void) => () => void
      /**
       * The shell started or stopped running something (a child process, or a command it was
       * launched with) — fired on change only. Backed by the session daemon's activity poller; the
       * Electron build has no equivalent probe, so there it never fires and tabs read idle.
       */
      onLocalActivity: (id: string, cb: (busy: boolean) => void) => () => void
      listLocalSessions: () => Promise<Array<{
        id: string
        generation: number
        policy: 'close-with-app' | 'keep-running' | 'recover-after-reboot'
        lifecycle: 'live' | 'interrupted' | 'closed' | 'error'
        pid?: number | null
        label: string
        busy: boolean
        launchedWithCommand: boolean
        ssh: boolean
      }>>
      setPersistencePolicy: (id: string, policy: 'close-with-app' | 'keep-running' | 'recover-after-reboot') => Promise<void>
    }
    // Multi-window terminal detach/reattach. `detachedSessionId` is non-null only inside a
    // popped-out window (from its --omniterm-detached=<id> launch arg); the primary reads null.
    terminalWindow: {
      /** Non-null in a popped-out window; it is the window's label, not the session id. */
      detachedSessionId: string | null
      detach: (payload: { sessionId: string; name: string; connection: any }) => Promise<boolean>
      /** Which session this window owns — resolved from the calling window, so never another's. */
      bootstrap: () => Promise<{ sessionId: string; name: string; connection: any } | null>
      /**
       * Bind to a running session. `data` is always empty: the scrollback is replayed down the
       * session's own data channel before this resolves, so it reaches the caller's onData handler
       * instead of being serialized here.
       */
      resume: (sessionId: string) => Promise<{ data: Uint8Array; status: 'connecting' | 'ready' | 'error' | 'closed'; label?: string; error?: string; busy?: boolean; generation: number } | null>
      reattach: (sessionId: string) => Promise<boolean>
      focus: (sessionId: string) => void
      release: (sessionId: string) => void
      onReattached: (cb: (sessionId: string) => void) => () => void
      /** The detached window closed an idle session outright (no fold-back) — the session is gone. */
      onClosed: (cb: (sessionId: string) => void) => () => void
    }
    clipboard: {
      writeText: (text: string) => Promise<void>
      readText: () => Promise<string>
    }
    sftp: {
      home: (id: string) => Promise<string>
      list: (id: string, path: string) => Promise<Array<{ name: string; size: number; mtime: number; isDir: boolean; isSymlink: boolean }>>
      realpath: (id: string, path: string) => Promise<string>
      mkdir: (id: string, path: string) => Promise<void>
      rename: (id: string, oldPath: string, newPath: string) => Promise<void>
      delete: (id: string, path: string) => Promise<void>
      rmdirRecursive: (id: string, path: string) => Promise<void>
      download: (id: string, remotePath: string, suggestedName: string) => Promise<boolean>
      upload: (id: string, remoteDir: string) => Promise<number>
      onProgress: (id: string, cb: (p: { kind: 'download' | 'upload'; name: string; transferred: number; total: number } | null) => void) => () => void
    }
    app: {
      platform: NodeJS.Platform
      revealLog: () => Promise<string>
      clearLog: () => Promise<boolean>
      /** Open a local file or directory with the OS's default handler. URLs refused by the backend. */
      openInSystem: (path: string) => Promise<void>
      setZoomFactor: (factor: number) => void
      getZoomFactor: () => number
    }
    files: {
      exportJson: (opts: { suggestedName: string; content: string }) => Promise<boolean>
      importJson: () => Promise<string | null>
      // One shape only. There is no encrypted-backup variant, because there is no credential to
      // protect; the backend rejects an encrypted file from an older build with a migration hint.
      importFile: () => Promise<null | { folders: any[]; connections: any[] }>
      getHomeDir: () => Promise<string>
      pickDirectory: (defaultPath?: string) => Promise<string | null>
    }
    customArt: {
      upload: (slot: 'idle-light' | 'idle-dark' | 'loading-light' | 'loading-dark') => Promise<string>
      get: (slot: 'idle-light' | 'idle-dark' | 'loading-light' | 'loading-dark') => Promise<string | null>
      remove: (slot: 'idle-light' | 'idle-dark' | 'loading-light' | 'loading-dark') => Promise<void>
    }
    settings: {
      get: () => Promise<AppSettings>
      save: (s: Partial<AppSettings>) => Promise<void>
      /** Broadcast by the backend after any window saves settings — keeps detached windows in sync. */
      onChanged: (cb: (s: AppSettings) => void) => () => void
      systemExcludedViewExts: () => Promise<string[]>
    }
    // Workspace view: composite containers of real folder roots, nested by stable workspace id.
    workspace: {
      list: () => Promise<import('@omniterm/contract').Workspace[]>
      create: (name: string) => Promise<import('@omniterm/contract').Workspace>
      add: () => Promise<import('@omniterm/contract').Workspace | null>
      addFolder: (workspaceId: string) => Promise<import('@omniterm/contract').Workspace | null>
      removeFolder: (workspaceId: string, folderId: string) => Promise<import('@omniterm/contract').Workspace>
      importFile: () => Promise<import('@omniterm/contract').Workspace | null>
      remove: (id: string) => Promise<void>
      rename: (workspaceId: string, name: string) => Promise<import('@omniterm/contract').Workspace>
      setAppearance: (workspaceId: string, color?: import('@omniterm/contract').Workspace['color'], icon?: import('@omniterm/contract').Workspace['icon']) => Promise<import('@omniterm/contract').Workspace>
      setFolderColor: (workspaceId: string, folderId: string, color?: import('@omniterm/contract').WorkspaceFolder['color']) => Promise<import('@omniterm/contract').Workspace>
      move: (workspaceId: string, parentId: string | null, index: number) => Promise<import('@omniterm/contract').Workspace[]>
      setPinned: (workspaceId: string, folderId: string, path: string, pinned: boolean) => Promise<import('@omniterm/contract').Workspace>
      scanScripts: (id: string) => Promise<import('@omniterm/contract').WorkspaceScript[]>
      // The whole directory skeleton of a workspace — every folder, no files — shown up front.
      scanFolders: (id: string) => Promise<import('@omniterm/contract').WorkspaceEntry[]>
      // One page directly under a logical `<folderId>/<relativePath>` location. An empty folder
      // addresses the composite virtual root and therefore contains no filesystem entries.
      scanFolderEntries: (id: string, folder?: string, offset?: number, limit?: number) => Promise<import('@omniterm/contract').WorkspaceEntryPage>
      run: (payload: { workspaceId: string; script?: import('@omniterm/contract').WorkspaceScript; subPath?: string }) => Promise<boolean>
      readScript: (workspaceId: string, scriptPath: string) => Promise<string>
      writeScript: (workspaceId: string, scriptPath: string, content: string) => Promise<void>
      loadConnections: (workspaceId: string) => Promise<import('@omniterm/contract').Connection[]>
      saveConnections: (workspaceId: string, connections: import('@omniterm/contract').Connection[]) => Promise<void>
      deleteConnection: (workspaceId: string, connectionId: string) => Promise<void>
    }
    updates: {
      check: () => Promise<UpdateState>
      state: () => Promise<UpdateState>
      skip: (version: string | null) => Promise<UpdateState>
      getVersion: () => Promise<string>
      showSaveDialog: (defaultName: string) => Promise<string | null>
      downloadPortable: (savePath: string) => Promise<void>
      downloadInstaller: (installNow: boolean) => Promise<void>
      onState: (cb: (s: UpdateState) => void) => () => void
    }
    themes: {
      list: () => Promise<import('./themes').AppTheme[]>
      openFolder: () => Promise<void>
      save: (theme: import('./themes').AppTheme) => Promise<void>
      delete: (id: string) => Promise<void>
    }
    alwaysAwake: {
      getState: () => Promise<AlwaysAwakeStatus>
      setState: (payload: { enabled: boolean; mode: AlwaysAwakeMode; expiresAtMs: number }) => Promise<AlwaysAwakeStatus>
      disable: () => Promise<AlwaysAwakeStatus>
      onState: (cb: (state: AlwaysAwakeStatus) => void) => () => void
    }
    windowControl: {
      minimize: () => Promise<void>
      toggleMaximize: () => Promise<void>
      close: () => Promise<void>
      isMaximized: () => Promise<boolean>
      onMaximizedState: (cb: (state: boolean) => void) => () => void
    }
    // Cooperative launcher (nc-open): main asks the renderer to open an ad-hoc local shell pane.
    shells: {
      ready: () => void
      release: (connId: string) => void
      /**
       * Register an unsaved shell ("new session") and return the Connection record to open it with.
       * The Tauri backend validates and registers the shell before a pane can resolve it.
       */
      open: (shell?: string, workspaceId?: string | null, folderId?: string | null, cwd?: string | null, command?: string | null) => Promise<Record<string, unknown> | null>
      /**
       * The shells installed on this machine.
       */
      list: () => Promise<Array<{ id: string; label: string }>>
      onOpen: (cb: (conn: { id: string; name: string; type: 'LOCAL'; host: string; port: string; user: string; shell: 'wsl' | 'powershell' | 'cmd'; localCwd?: string; localCommand?: string; localArgs?: string; localKeepOpen?: boolean }) => void) => () => void
    }
  }
}
