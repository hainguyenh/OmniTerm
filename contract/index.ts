/**
 * @omniterm/contract — the stable boundary between the terminal HOST and its optional plugins.
 *
 * The host (this app) ships with none of the connection-manager or auth-provider code. A plugin is a
 * Node module loaded by the host's main process at startup that calls `activate(host)` and registers
 * providers against the `HostAPI` below. If no plugin is present the app is just a terminal.
 *
 * Nothing here has a runtime dependency; it is types + interfaces only, so both the host and any
 * plugin can depend on it without coupling to each other.
 */

// ── Shared domain types (previously declared in src/components/MainLayout.tsx) ──────────────────

/** Which local shell a LOCAL connection spawns via ConPTY. */
export type LocalShell = 'wsl' | 'powershell' | 'cmd' | 'default' | 'zsh' | 'bash' | 'sh'

/** Live status of one running session (per-instance). */
export type SessionStatus = 'connecting' | 'connected' | 'closed' | 'error'

/**
 * A connection the user can open. It carries metadata only. Passwords are entered directly into the
 * native SSH/RDP prompt and are never represented by this contract.
 */
export type Connection = {
  id: string
  name: string
  type: 'SSH' | 'RDP' | 'LOCAL'
  /** Renderer-side workspace association for sessions opened from the Workspace view. */
  workspaceId?: string
  host: string
  port: string
  user: string
  /** Optional HTTPS page opened by a password-free provider immediately before connecting. */
  passwordHelpUrl?: string
  parentId?: string
  redirectDrives?: boolean   // RDP only: share local drives with the remote session
  shell?: LocalShell         // LOCAL only: which local shell to spawn
  localArgs?: string         // LOCAL only: extra args appended to the shell executable
  localCwd?: string          // LOCAL only: working directory (default: home dir)
  localCommand?: string      // LOCAL only: an optional command/batch to run in-pane
  localKeepOpen?: boolean    // LOCAL only: keep the pane open after the command finishes
}


/** A folder node in the connection tree. */
export type Folder = {
  id: string
  name: string
  parentId?: string
}

/** The full saved tree a ConnectionProvider owns. */
export interface ConnectionTree {
  connections: Connection[]
  folders: Folder[]
}

// ── Workspace domain types ────────────────────────────────────────────────────────────────────

/** One real local folder root owned by a saved OmniTerm workspace container. */
export interface WorkspaceFolder {
  id: string
  name: string
  path: string
}

/** Structural presentation pin. Empty `path` means the folder root itself. */
export interface WorkspacePin {
  folderId: string
  path: string
}

/**
 * A saved workspace container. It may own many local folder roots and may be nested under another
 * workspace by reference. `order` is the sibling position within `parentId` (or the root list).
 */
export interface Workspace {
  id: string
  name: string
  folders: WorkspaceFolder[]
  parentId?: string
  order: number
  pins: WorkspacePin[]
}

/**
 * A runnable item discovered inside a workspace. `kind` is an open string so plugins can add their
 * own kinds beyond the built-in bat/ps1/sh (executable scripts) and rdp (a launchable .rdp file).
 */
export interface WorkspaceScript {
  id: string
  name: string
  /** Logical path namespaced as `<workspaceFolderId>/<relativePath>`. */
  path: string
  kind: 'bat' | 'ps1' | 'sh' | 'rdp' | string
  /** Suggested shell to run the script under; the host falls back to a sensible default. */
  shell?: 'wsl' | 'powershell' | 'cmd'
  /** Whether the item's contents can be *saved* by the built-in editor (executable scripts only). */
  editable?: boolean
  /**
   * Whether the built-in viewer will show the contents as text. Wider than `editable`: a `.txt`, a
   * `.json` or a `.rdp` is viewable but read-only. Absent is treated as not viewable, so a provider
   * that predates this field keeps its previous behaviour.
   */
  viewable?: boolean
}

/**
 * One thing found inside a workspace: a directory, a runnable script, or any other file.
 *
 * A superset of `WorkspaceScript`. The host's Workspace panel renders the whole folder tree and
 * filters it in the renderer (folders + scripts by default; all files, or a chosen set of types, on
 * request), so one scan has to describe everything a project folder contains — including directories
 * that hold no scripts at all, which a scripts-only scan can never report.
 */
export interface WorkspaceEntry {
  /**
   * Logical path namespaced as `<workspaceFolderId>/<relativePath>`. Stable across scans, and the
   * value a workspace-scoped `Connection` puts in `parentId` to identify its real folder root.
   */
  id: string
  name: string
  /** Same folder-namespaced logical path as `id`; never an absolute filesystem path. */
  path: string
  isDir: boolean
  /** `'dir'` for a directory; else the script kind, else the lowercased extension, else `'file'`. */
  kind: 'dir' | 'bat' | 'ps1' | 'sh' | 'rdp' | 'file' | string
  shell?: 'wsl' | 'powershell' | 'cmd'
  /** Only runnable text files set this; a plain file leaves it absent. */
  editable?: boolean
  /**
   * Whether the built-in viewer will show this file as text — see `WorkspaceScript.viewable`. Set on
   * every file the scan reports; absent for a directory, which has no contents to show.
   */
  viewable?: boolean
}

/**
 * One page of a folder's files, plus the totals that let that folder's "Show more" row count down.
 * The host lists one folder at a time (directory listings only), so `total` and `hasMore` are exact —
 * paging bounds the payload, it never hides files.
 */
export interface WorkspaceEntryPage {
  entries: WorkspaceEntry[]
  /** Every entry the workspace holds — directories included — not just this page. */
  total: number
  /** Whether more entries exist past this page. */
  hasMore: boolean
}

/** An action a provider offers for a script (defaults to a single "Run"); lets plugins expand
 *  what "run" means (e.g. run with args, dry-run, run in a specific shell). */
export interface WorkspaceRunAction {
  id: string
  label: string
  script: WorkspaceScript
}

/**
 * Supplies the data behind the host's Workspace view. Like ConnectionProvider, every method runs
 * in the main process. When no plugin registers one, the host uses a built-in default provider
 * (settings-backed folder list + a shallow on-disk script scan) so the view works standalone.
 */
export interface WorkspaceProvider {
  listWorkspaces(): Workspace[] | Promise<Workspace[]>
  addWorkspace(path: string): Workspace | Promise<Workspace>
  removeWorkspace(id: string): void | Promise<void>
  scanScripts(workspaceId: string): WorkspaceScript[] | Promise<WorkspaceScript[]>
  /**
   * Optional: the workspace's full contents — every folder and file, not just the runnables — for the
   * host's folder tree and its type filter. Absent = the host falls back to `scanScripts`, and the
   * tree can then only show folders that contain a script.
   */
  scanEntries?(workspaceId: string): WorkspaceEntry[] | Promise<WorkspaceEntry[]>
  /** Optional: actions offered per script. Absent = the host offers a single default "Run". */
  runActions?(script: WorkspaceScript): WorkspaceRunAction[] | Promise<WorkspaceRunAction[]>
  /**
   * Optional: read a file's text for the built-in viewer/editor. Called for any item the provider
   * marked `viewable` (or, for a provider predating that field, any `editable` item). Absent = the
   * host treats items as unreadable and the view/edit UI is hidden.
   */
  readScript?(workspaceId: string, scriptPath: string): string | Promise<string>
  /** Optional: persist an edited script. Absent = the viewer is read-only. */
  writeScript?(workspaceId: string, scriptPath: string, content: string): void | Promise<void>
  /**
   * Optional: load connection profiles scoped to a workspace (stored in `.omniterm/connections.json`
   * inside the workspace folder). Absent = the host shows no workspace connections.
   */
  loadConnections?(workspaceId: string): Connection[] | Promise<Connection[]>
  /** Optional: persist workspace-scoped connections. Absent = connections are read-only. */
  saveConnections?(workspaceId: string, connections: Connection[]): void | Promise<void>
}

// ── Plugin API (main-process side) ──────────────────────────────────────────────────────────────

export const PLUGIN_API_VERSION = 2

export type ConnectionCredentialPolicy = 'prompt-every-time'

export interface ConnectionProviderCapabilities {
  protocols: Array<'SSH' | 'RDP'>
  credentialPolicy: ConnectionCredentialPolicy
  scopes: Array<'personal' | 'workspace'>
  sftp: boolean
  importExport: boolean
}

export type ConnectionScope =
  | { kind: 'personal' }
  | { kind: 'workspace'; workspaceId: string; workspacePath: string }

/**
 * A provider-owned launcher. The host executes only a validated batch file beneath the provider's
 * storage directory or a workspace's `.omniterm/launchers` directory.
 */
export interface ConnectionLaunchSpec {
  kind: 'batch'
  path: string
  presentation: 'terminal' | 'detached'
}

/** Capabilities a plugin must declare before the host exposes or accepts the related API. */
export type PluginPermission =
  | 'connections'
  | 'auth'
  | 'renderer'
  | 'openExternal'
  | 'clipboard'
  | 'workspace'

export type PluginStatus = 'disabled' | 'loaded' | 'error' | 'incompatible'

/** Validated metadata returned by the plugin-management API. */
export interface PluginDescriptor {
  id: string
  name: string
  description?: string
  version: string
  apiVersion: number
  hostVersion: string
  permissions: PluginPermission[]
  source: 'bundled' | 'user'
  enabled: boolean
  status: PluginStatus
  error?: string
  activeConnectionProvider: boolean
  selectedConnectionProvider: boolean
  activeAuthProvider: boolean
  activeInvokeHandler: boolean
}

/** Owns the saved connection tree. All returned connections contain metadata only. */
export interface ConnectionProvider {
  /** Describes the generic Tauri UI the host should expose for this provider. */
  capabilities?(): ConnectionProviderCapabilities | Promise<ConnectionProviderCapabilities>
  /** Metadata-only connection tree. */
  load(): ConnectionTree | Promise<ConnectionTree>
  /** Persist a tree edited by the user. */
  save(tree: ConnectionTree): void | Promise<void>
  /** Resolve a saved connection at connect time. */
  resolve(connId: string): Connection | null | Promise<Connection | null>
  /** API v2 scoped variants. Legacy methods above continue to represent the Personal scope. */
  loadScoped?(scope: ConnectionScope): ConnectionTree | Promise<ConnectionTree>
  saveScoped?(scope: ConnectionScope, tree: ConnectionTree): void | Promise<void>
  resolveScoped?(
    scope: ConnectionScope,
    connId: string,
  ): Connection | null | Promise<Connection | null>
  resolveLaunch?(
    scope: ConnectionScope,
    connId: string,
  ): ConnectionLaunchSpec | null | Promise<ConnectionLaunchSpec | null>
}

/**
 * Optional app-open gate. When a plugin registers one, the host awaits `gate()` before revealing
 * the workspace; `true` = authorized. Absent (the host default) = no auth, straight to the terminal.
 */
export interface AuthProvider {
  gate(): boolean | Promise<boolean>
}


/** Host-provided capabilities a plugin may use. */
export interface HostServices {
  /** A private, plugin-owned directory under the app's userData for the plugin to store files. */
  storageDir: string
  log(message: string): void
  openExternal(url: string): Promise<void>
  writeClipboard(text: string): Promise<void>
}

/** Passed to `activate()`. A plugin registers its providers and an optional invoke handler here. */
export interface HostAPI {
  readonly plugin: {
    id: string
    version: string
    permissions: readonly PluginPermission[]
  }
  services: HostServices
  registerConnectionProvider(provider: ConnectionProvider): void
  registerAuthProvider(provider: AuthProvider): void
  /** Contribute the data behind the host's Workspace view (requires the "workspace" permission). */
  registerWorkspaceProvider(provider: WorkspaceProvider): void
  /**
   * Handle renderer→plugin calls routed through the host's generic `plugin:invoke` IPC channel.
   * `method` is a plugin-defined string; the return value is sent back to the renderer.
   */
  registerInvokeHandler(handler: (method: string, ...args: unknown[]) => unknown): void
}

/** The shape a plugin module's default export (or `module.exports`) must satisfy. */
export interface PluginModule {
  name: string
  activate(host: HostAPI): void | Promise<void>
  /** Release listeners/resources when the plugin is disabled or the host reloads plugins. */
  deactivate?(): void | Promise<void>
}
