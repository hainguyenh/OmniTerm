/**
 * Local mirror of the `@omniterm/contract` plugin API. Duplicated here (rather than imported) so
 * this plugin builds to CommonJS completely independently of the workspace — it is shipped as a
 * standalone drop-in package. Keep these shapes in sync with contract/index.ts; the host validates
 * structurally at the `activate(host)` boundary.
 */

export type LocalShell = 'wsl' | 'powershell' | 'cmd' | 'default' | 'zsh' | 'bash' | 'sh'

/** Carries no credential — see the note on `Connection` in contract/index.ts. */
export type Connection = {
  id: string
  name: string
  type: 'SSH' | 'RDP' | 'LOCAL'
  host: string
  port: string
  user: string
  passwordHelpUrl?: string
  hasStoredCredential?: boolean
  parentId?: string
  redirectDrives?: boolean
  shell?: LocalShell
  localArgs?: string
  localCwd?: string
  localCommand?: string
  localKeepOpen?: boolean
}

/** Main-process only: a connection plus the secret this plugin resolved for it. */
export type ResolvedConnection = Connection & { password?: string }

export type Folder = { id: string; name: string; parentId?: string }

export interface ConnectionTree {
  connections: Connection[]
  folders: Folder[]
}

export interface ConnectionProviderCapabilities {
  protocols: Array<'SSH' | 'RDP'>
  credentialPolicy: 'os-vault' | 'prompt-every-time'
  scopes: Array<'personal' | 'workspace'>
  sftp: boolean
  importExport: boolean
}

export type ConnectionScope =
  | { kind: 'personal' }
  | { kind: 'workspace'; workspaceId: string; workspacePath: string }

export interface ConnectionProvider {
  capabilities?(): ConnectionProviderCapabilities | Promise<ConnectionProviderCapabilities>
  load(): ConnectionTree | Promise<ConnectionTree>
  save(tree: ConnectionTree): void | Promise<void>
  resolve(connId: string): ResolvedConnection | null | Promise<ResolvedConnection | null>
  loadScoped?(scope: ConnectionScope): ConnectionTree | Promise<ConnectionTree>
  saveScoped?(scope: ConnectionScope, tree: ConnectionTree): void | Promise<void>
  resolveScoped?(scope: ConnectionScope, connId: string): ResolvedConnection | null | Promise<ResolvedConnection | null>
}

export interface AuthProvider {
  gate(): boolean | Promise<boolean>
}

/**
 * OS-bound credential storage. The Windows host scopes every key to this plugin.
 */
export interface CredentialStore {
  isAvailable(): boolean
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export type PluginPermission =
  | 'connections'
  | 'auth'
  | 'renderer'
  | 'credentials'
  | 'openExternal'
  | 'clipboard'
  | 'workspace'

export interface HostServices {
  storageDir: string
  credentials: CredentialStore
  log(message: string): void
  openExternal(url: string): Promise<void>
  writeClipboard(text: string): Promise<void>
}

export interface HostAPI {
  readonly plugin: {
    id: string
    version: string
    permissions: readonly PluginPermission[]
  }
  services: HostServices
  registerConnectionProvider(provider: ConnectionProvider): void
  registerAuthProvider(provider: AuthProvider): void
  registerInvokeHandler(handler: (method: string, ...args: unknown[]) => unknown): void
}

export interface PluginModule {
  name: string
  activate(host: HostAPI): void | Promise<void>
  deactivate?(): void | Promise<void>
}
