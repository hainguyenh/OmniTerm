/**
 * @omniterm/contract — the stable boundary between the terminal HOST and its optional plugins.
 *
 * The host (this app) ships with none of the connection-manager / vault / auth code. A plugin is a
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
 * A connection the user can open. It carries no secret, anywhere, ever — the host never stores,
 * derives, or transports a credential, so there is no field here for one and no code path that could
 * populate it. A password is typed by the user at the server's own prompt, inside the terminal.
 *
 * A plugin may still offer stored credentials as an advanced feature; that is what
 * `ResolvedConnection` below is for, and it exists only in the main process.
 */
export type Connection = {
  id: string
  name: string
  type: 'SSH' | 'RDP' | 'LOCAL'
  host: string
  port: string
  user: string
  /** Optional HTTPS page opened by a password-free provider immediately before connecting. */
  passwordHelpUrl?: string
  /** Renderer-safe indicator only; the credential itself remains main-process/OS-vault scoped. */
  hasStoredCredential?: boolean
  parentId?: string
  redirectDrives?: boolean   // RDP only: share local drives with the remote session
  shell?: LocalShell         // LOCAL only: which local shell to spawn
  localArgs?: string         // LOCAL only: extra args appended to the shell executable
  localCwd?: string          // LOCAL only: working directory (default: home dir)
  localCommand?: string      // LOCAL only: an optional command/batch to run in-pane
  localKeepOpen?: boolean    // LOCAL only: keep the pane open after the command finishes
}

/**
 * A connection plus a secret a plugin resolved for it at connect time.
 *
 * Deliberately a separate type rather than an optional field on `Connection`: the host passes
 * `Connection` to the renderer, and a type that cannot hold a password cannot leak one by being
 * forwarded to the wrong side. Only `ConnectionProvider.resolve()` returns this, only in the main
 * process, and the value must never be serialized back to a webview.
 */
export type ResolvedConnection = Connection & { password?: string }

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

/**
 * A local project/workspace folder the user has pinned in the Workspace view. The host renders
 * whatever the active WorkspaceProvider returns, so plugins may source these from anywhere
 * (git repos, a monorepo config, a remote index) — not just the on-disk default.
 */
export interface Workspace {
  id: string
  name: string
  path: string
  pinned?: boolean
}

/**
 * A runnable item discovered inside a workspace. `kind` is an open string so plugins can add their
 * own kinds beyond the built-in bat/ps1/sh (executable scripts) and rdp (a launchable .rdp file).
 */
export interface WorkspaceScript {
  id: string
  name: string
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
   * POSIX-style path relative to the workspace root. Stable across scans, and the value a
   * workspace-scoped `Connection` puts in `parentId` to say which folder it belongs to.
   */
  id: string
  name: string
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

export type ConnectionCredentialPolicy = 'os-vault' | 'prompt-every-time'

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
  | 'credentials'
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

/**
 * Owns the saved connection tree. All methods run in the main process (plugins load there), so
 * `resolve()` may return a secret — it never crosses to the renderer. `load()`, by contrast, returns
 * the renderer-facing tree, and its `Connection` type has nowhere to put a secret by construction.
 */
export interface ConnectionProvider {
  /** Describes the generic Tauri UI the host should expose for this provider. */
  capabilities?(): ConnectionProviderCapabilities | Promise<ConnectionProviderCapabilities>
  /** Renderer-safe tree. `Connection` carries no credential field, so this cannot leak one. */
  load(): ConnectionTree | Promise<ConnectionTree>
  /** Persist a tree edited by the user. */
  save(tree: ConnectionTree): void | Promise<void>
  /**
   * Resolve the FULL connection (including any secret) for a saved id, at connect time, in the main
   * process. Return null if the id is unknown. This is where credential conveniences live: a plugin
   * may, e.g., open a password URL via HostServices and return the connection without a password so
   * the user types it into the session instead of storing it.
   */
  resolve(connId: string): ResolvedConnection | null | Promise<ResolvedConnection | null>
  /** API v2 scoped variants. Legacy methods above continue to represent the Personal scope. */
  loadScoped?(scope: ConnectionScope): ConnectionTree | Promise<ConnectionTree>
  saveScoped?(scope: ConnectionScope, tree: ConnectionTree): void | Promise<void>
  resolveScoped?(
    scope: ConnectionScope,
    connId: string,
  ): ResolvedConnection | null | Promise<ResolvedConnection | null>
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

/**
 * Secret storage scoped to one plugin.
 *
 * **The host does not implement this.** OmniTerm never holds a password, in any form, anywhere — so
 * the store it hands a plugin refuses every write and reports `isAvailable() === false`. The interface
 * exists so a plugin that genuinely needs persistence can supply its own implementation and keep the
 * rest of this contract; the security of whatever it writes is then that plugin's responsibility.
 *
 * Prefer designing around it: `credentialMode: 'none'` (the user types the password into the session)
 * and `'url'` (open where it is kept so the user copies it) need no storage at all.
 *
 * An earlier revision of this comment promised values "encrypted by Electron `safeStorage` (DPAPI on
 * Windows, Keychain on macOS)". That was never true of the Tauri build, and a plugin that trusted it
 * deleted the password it thought it had stored. Treat a resolving `set()` as the only evidence of a
 * write, and check `isAvailable()` first.
 */
export interface CredentialStore {
  /** False in the stock host. Check before offering the user any "remember my password" affordance. */
  isAvailable(): boolean
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/** Host-provided capabilities a plugin may use. */
export interface HostServices {
  /** A private, plugin-owned directory under the app's userData for the plugin to store files. */
  storageDir: string
  /** OS-user-bound storage for passwords and other secrets. */
  credentials: CredentialStore
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
