/** Standalone mirror of the public OmniTerm plugin contract. */

export type LocalShell = 'wsl' | 'powershell' | 'cmd' | 'default' | 'zsh' | 'bash' | 'sh'

export type Connection = {
  id: string
  name: string
  type: 'SSH' | 'RDP' | 'LOCAL'
  host: string
  port: string
  user: string
  passwordHelpUrl?: string
  parentId?: string
  redirectDrives?: boolean
  shell?: LocalShell
  localArgs?: string
  localCwd?: string
  localCommand?: string
  localKeepOpen?: boolean
}

export type Folder = { id: string; name: string; parentId?: string }
export interface ConnectionTree { connections: Connection[]; folders: Folder[] }

export interface ConnectionProviderCapabilities {
  protocols: Array<'SSH' | 'RDP'>
  credentialPolicy: 'prompt-every-time'
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
  resolve(connId: string): Connection | null | Promise<Connection | null>
  loadScoped?(scope: ConnectionScope): ConnectionTree | Promise<ConnectionTree>
  saveScoped?(scope: ConnectionScope, tree: ConnectionTree): void | Promise<void>
  resolveScoped?(scope: ConnectionScope, connId: string): Connection | null | Promise<Connection | null>
}

export interface AuthProvider { gate(): boolean | Promise<boolean> }
export type PluginPermission =
  | 'connections'
  | 'auth'
  | 'renderer'
  | 'openExternal'
  | 'clipboard'
  | 'workspace'

export interface HostServices {
  storageDir: string
  log(message: string): void
  openExternal(url: string): Promise<void>
  writeClipboard(text: string): Promise<void>
}

export interface HostAPI {
  readonly plugin: { id: string; version: string; permissions: readonly PluginPermission[] }
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
