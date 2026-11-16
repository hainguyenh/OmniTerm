/**
 * Domain types shared by the renderer: connections, sessions and workspaces. Types only; nothing
 * here has a runtime dependency.
 */


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
  /** Optional HTTPS page opened immediately before connecting (a password-help page). */
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
  color?: WorkspaceColor
}

export type WorkspaceColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray'
export type WorkspaceIcon = 'folder' | 'briefcase' | 'layers' | 'code' | 'server' | 'star'

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
  color?: WorkspaceColor
  icon?: WorkspaceIcon
}

/**
 * A runnable item discovered inside a workspace. `kind` is an open string so new sources can add their
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
  /**
   * Set on a directory the skeleton does not descend into (`node_modules`, `dist`, … and everything
   * below them): its subfolders arrive with its first page (`WorkspaceEntryPage.subfolders`).
   */
  deferred?: boolean
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
  /** A deferred folder's direct subfolders, on its first page only; absent otherwise. */
  subfolders?: WorkspaceEntry[]
}
