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
}

export type Folder = { id: string; name: string; parentId?: string }
export type ConnectionTree = { connections: Connection[]; folders: Folder[] }
export type ResolvedConnection = Connection & { password?: string }
export type ConnectionScope =
  | { kind: 'personal' }
  | { kind: 'workspace'; workspaceId: string; workspacePath: string }

export type ConnectionLaunchSpec = {
  kind: 'batch'
  path: string
  presentation: 'terminal' | 'detached'
}

export interface ConnectionProvider {
  capabilities(): {
    protocols: Array<'SSH' | 'RDP'>
    credentialPolicy: 'prompt-every-time'
    scopes: Array<'personal' | 'workspace'>
    sftp: false
    importExport: true
  }
  load(): ConnectionTree | Promise<ConnectionTree>
  save(tree: ConnectionTree): void | Promise<void>
  resolve(id: string): ResolvedConnection | null | Promise<ResolvedConnection | null>
  loadScoped?(scope: ConnectionScope): ConnectionTree | Promise<ConnectionTree>
  saveScoped?(scope: ConnectionScope, tree: ConnectionTree): void | Promise<void>
  resolveScoped?(scope: ConnectionScope, id: string): ResolvedConnection | null | Promise<ResolvedConnection | null>
  resolveLaunch?(scope: ConnectionScope, id: string): ConnectionLaunchSpec | null | Promise<ConnectionLaunchSpec | null>
}

export interface HostAPI {
  readonly plugin: { id: string; version: string; permissions: readonly string[] }
  services: {
    storageDir: string
    log(message: string): void
    openExternal(url: string): Promise<void>
  }
  registerConnectionProvider(provider: ConnectionProvider): void
}

export interface PluginModule {
  name: string
  activate(host: HostAPI): void | Promise<void>
  deactivate?(): void | Promise<void>
}
