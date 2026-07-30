import { BatchConnectionStore } from './store'
import type { ConnectionProvider, ConnectionScope, PluginModule } from './types'

export const name = '@omniterm/native-batch-connections'

export function activate(host: Parameters<PluginModule['activate']>[0]): void {
  const store = new BatchConnectionStore(host.services.storageDir)
  const personal: ConnectionScope = { kind: 'personal' }
  const provider: ConnectionProvider = {
    capabilities: () => ({
      protocols: ['SSH', 'RDP'],
      credentialPolicy: 'prompt-every-time',
      scopes: ['personal', 'workspace'],
      sftp: false,
      importExport: true,
    }),
    load: () => store.load(personal),
    save: (tree) => store.save(personal, tree),
    resolve: (id) => store.resolve(personal, id),
    loadScoped: (scope) => store.load(scope),
    saveScoped: (scope, tree) => store.save(scope, tree),
    resolveScoped: (scope, id) => store.resolve(scope, id),
    resolveLaunch: async (scope, id) => {
      const connection = store.resolve(scope, id)
      if (connection?.passwordHelpUrl) await host.services.openExternal(connection.passwordHelpUrl)
      return store.resolveLaunch(scope, id)
    },
  }
  host.registerConnectionProvider(provider)
  host.services.log('Limited Connections activated')
}

export function deactivate(): void {}

const plugin: PluginModule = { name, activate, deactivate }
export default plugin
