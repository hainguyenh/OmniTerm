/**
 * plugin-host.cjs — Node.js Sidecar Main Entry Point for OmniTerm Plugin System
 */
const fs = require('fs')
const path = require('path')
const { JsonRpcProtocol } = require('./protocol.cjs')
const { HostAPIImpl } = require('./host-api.cjs')
const { describePlugin } = require('./manifest.cjs')

/**
 * The host's app-data directory, passed as argv[2].
 *
 * Validated rather than defaulted: this path is the root of both plugin discovery and every plugin's
 * private storage, so a wrong value silently relocates all of it. Running the sidecar with a stray
 * flag as argv[2] previously created a `--test/plugins/` directory next to the source tree — proof
 * that a typo could redirect the whole store without anyone noticing. Refuse instead of guessing.
 */
const appDataDir = process.argv[2]
if (!appDataDir || !path.isAbsolute(appDataDir)) {
  console.error('[plugin-host] usage: plugin-host.cjs <absolute-app-data-dir>')
  process.exit(2)
}
const pluginsDir = path.join(appDataDir, 'plugins')
const providerPreferenceFile = path.join(appDataDir, 'active-connection-provider.json')

/** Optional bundled-plugin directory supplied by a selected app build or explicit dev command. */
const bundledPluginDir = process.argv[3] && path.isAbsolute(process.argv[3]) ? process.argv[3] : null

try {
  fs.mkdirSync(pluginsDir, { recursive: true })
} catch (err) {
  console.error(`[plugin-host] cannot create ${pluginsDir}:`, err.message)
  process.exit(2)
}

const protocol = new JsonRpcProtocol()


class Registry {
  constructor() {
    this.descriptors = new Map() // id -> PluginDescriptor
    this.modules = new Map() // id -> PluginModule instance
    this.connectionProviders = new Map() // id -> ConnectionProvider
    this.authProviders = new Map() // id -> AuthProvider
    this.workspaceProviders = new Map() // id -> WorkspaceProvider
    this.invokeHandlers = new Map() // id -> handler function
    this.selectedConnectionProviderId = null
  }

  updateStatus(id, partial) {
    const desc = this.descriptors.get(id)
    if (desc) {
      Object.assign(desc, partial)
    }
  }
}

const registry = new Registry()

function readProviderPreference() {
  try {
    const parsed = JSON.parse(fs.readFileSync(providerPreferenceFile, 'utf8'))
    return typeof parsed.id === 'string' ? parsed.id : null
  } catch {
    return null
  }
}

let preferredConnectionProviderId = readProviderPreference()

function selectConnectionProvider(id, persist = true) {
  if (id !== null) {
    const desc = registry.descriptors.get(id)
    if (!desc || !desc.enabled || desc.status !== 'loaded' || !registry.connectionProviders.has(id)) {
      throw new Error(`Connection provider "${id}" is not available`)
    }
  }
  registry.selectedConnectionProviderId = id
  for (const [pluginId, desc] of registry.descriptors) {
    desc.selectedConnectionProvider = pluginId === id
  }
  if (persist) {
    fs.writeFileSync(providerPreferenceFile, JSON.stringify({ id }, null, 2))
    preferredConnectionProviderId = id
  }
  return id
}

function refreshConnectionProviderSelection() {
  const selected = registry.selectedConnectionProviderId
  if (selected) {
    const desc = registry.descriptors.get(selected)
    if (desc?.enabled && desc.status === 'loaded' && registry.connectionProviders.has(selected)) {
      return selected
    }
  }
  if (preferredConnectionProviderId) {
    const preferred = registry.descriptors.get(preferredConnectionProviderId)
    if (preferred?.enabled && preferred.status === 'loaded' && registry.connectionProviders.has(preferredConnectionProviderId)) {
      return selectConnectionProvider(preferredConnectionProviderId, false)
    }
  }
  // A plugin explicitly bundled into an app variant is the only safe first-run default. Merely
  // installing a user plugin must never silently replace the user's connection source.
  for (const [id, desc] of registry.descriptors) {
    if (desc.source === 'bundled' && desc.enabled && desc.status === 'loaded' && registry.connectionProviders.has(id)) {
      return selectConnectionProvider(id, false)
    }
  }
  return selectConnectionProvider(null, false)
}

function selectedConnectionProvider() {
  const id = refreshConnectionProviderSelection()
  return id ? registry.connectionProviders.get(id) ?? null : null
}

/**
 * Discover and load plugins from pluginsDir and bundled location
 */
function discoverPlugins() {
  const dirs = []
  const activations = []

  // The reference plugin, passed explicitly by the host in dev builds (argv[3]).
  //
  // This used to be guessed as `../../plugin` relative to this file. In a packaged build that resolves
  // outside the resource directory, so bundled discovery was dead there regardless — and a guess that
  // silently finds nothing is worse than not looking. A packaged build discovers only what the user
  // installed, which is the whole plug-and-play model; the reference plugin installs like any other.
  if (bundledPluginDir) {
    if (fs.existsSync(path.join(bundledPluginDir, 'package.json'))) {
      dirs.push({ dirPath: bundledPluginDir, source: 'bundled' })
    } else if (fs.existsSync(bundledPluginDir)) {
      for (const entry of fs.readdirSync(bundledPluginDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const dirPath = path.join(bundledPluginDir, entry.name)
          if (fs.existsSync(path.join(dirPath, 'package.json'))) dirs.push({ dirPath, source: 'bundled' })
        }
      }
    }
  }

  // Everything the user installed.
  if (fs.existsSync(pluginsDir)) {
    for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        dirs.push({ dirPath: path.join(pluginsDir, entry.name), source: 'user' })
      }
    }
  }

  for (const { dirPath, source } of dirs) {
    const activation = loadPluginFromDir(dirPath, source)
    if (activation) activations.push(activation)
  }
  return Promise.allSettled(activations)
}

function loadPluginFromDir(dirPath, source) {
  const pkgPath = path.join(dirPath, 'package.json')
  if (!fs.existsSync(pkgPath)) return

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const descriptor = describePlugin(pkg, source)
    if (!descriptor) return

    const id = descriptor.id
    registry.descriptors.set(id, descriptor)

    // `describePlugin` runs every compatibility check BEFORE the `require` below, because loading a
    // module executes its top level — a plugin rejected afterwards would already have run.
    if (descriptor.status === 'incompatible') return

    const mainFile = path.resolve(dirPath, pkg.main || 'dist/index.js')
    if (!fs.existsSync(mainFile)) {
      descriptor.status = 'error'
      descriptor.error = `Main file not found: ${mainFile}`
      return
    }

    const mod = require(mainFile)
    const pluginMod = mod.default || mod
    registry.modules.set(id, pluginMod)

    const hostAPI = new HostAPIImpl(descriptor, appDataDir, protocol, registry)
    if (typeof pluginMod.activate === 'function') {
      return Promise.resolve(pluginMod.activate(hostAPI)).catch((err) => {
        descriptor.status = 'error'
        descriptor.error = `Activation error: ${err.message || String(err)}`
      })
    }
  } catch (err) {
    console.error(`Failed to load plugin at ${dirPath}:`, err)
  }
}

const discoveryReady = discoverPlugins()

// Handle incoming RPC requests from Rust
protocol.onRequest(async (method, params) => {
  // Full providers may initialize storage asynchronously. Do not publish a half-activated descriptor
  // (installed but with no active provider) merely because Settings opened quickly after startup.
  await discoveryReady
  switch (method) {
    case 'plugin.available': {
      for (const desc of registry.descriptors.values()) {
        if (desc.enabled && desc.status === 'loaded') return true
      }
      return false
    }

    case 'plugin.list': {
      refreshConnectionProviderSelection()
      return Array.from(registry.descriptors.values())
    }

    case 'plugin.selectConnectionProvider': {
      const { id } = params || {}
      selectConnectionProvider(id ?? null)
      return Array.from(registry.descriptors.values())
    }

    case 'plugin.setEnabled': {
      const { id, enabled } = params || {}
      const desc = registry.descriptors.get(id)
      if (!desc) throw new Error(`Plugin "${id}" not found`)
      desc.enabled = enabled
      const mod = registry.modules.get(id)
      if (!enabled && mod && typeof mod.deactivate === 'function') {
        try { await mod.deactivate() } catch { /* ignore */ }
      }
      if (!enabled && registry.selectedConnectionProviderId === id) {
        selectConnectionProvider(null)
      }
      return desc
    }

    // No 'plugin.install'. It copied a caller-supplied path in and `require`d it immediately — code
    // execution driven by whoever could reach the RPC, which included webview JS via the (now removed)
    // `plugin_install` command. Installing is an out-of-band act: `pnpm install:plugin <dir>`.

    case 'plugin.uninstall': {
      const { id } = params || {}
      const mod = registry.modules.get(id)
      if (mod && typeof mod.deactivate === 'function') {
        try { await mod.deactivate() } catch { /* ignore */ }
      }
      registry.descriptors.delete(id)
      registry.modules.delete(id)
      registry.connectionProviders.delete(id)
      registry.authProviders.delete(id)
      registry.workspaceProviders.delete(id)
      registry.invokeHandlers.delete(id)
      return true
    }

    case 'plugin.invoke': {
      const { method: invokeMethod, args } = params || {}
      // Invoke methods are namespaced per plugin; the first handler that answers owns the call.
      // Handlers throw for methods they do not recognise, so keep trying until one responds and
      // surface the first failure when none does.
      let firstError = null
      for (const [id, desc] of registry.descriptors.entries()) {
        if (desc.enabled && desc.status === 'loaded') {
          const handler = registry.invokeHandlers.get(id)
          if (handler) {
            try {
              return await handler(invokeMethod, ...(args || []))
            } catch (err) {
              firstError ??= err
            }
          }
        }
      }
      if (firstError) throw firstError
      throw new Error(`No active plugin handled method "${invokeMethod}"`)
    }

    case 'plugin.authGate': {
      for (const [id, desc] of registry.descriptors.entries()) {
        if (desc.enabled && desc.status === 'loaded') {
          const auth = registry.authProviders.get(id)
          if (auth) return await auth.gate()
        }
      }
      return true
    }

    case 'connections.load': {
      const cp = selectedConnectionProvider()
      return cp ? await cp.load() : null
    }

    case 'connections.save': {
      const { data } = params || {}
      const cp = selectedConnectionProvider()
      if (cp) {
        await cp.save(data)
        return true
      }
      return false
    }

    case 'connections.resolve': {
      const { connId } = params || {}
      const cp = selectedConnectionProvider()
      return cp ? await cp.resolve(connId) : null
    }

    case 'connections.capabilities': {
      const cp = selectedConnectionProvider()
      return cp && typeof cp.capabilities === 'function' ? await cp.capabilities() : null
    }

    case 'connections.loadScoped': {
      const cp = selectedConnectionProvider()
      if (!cp || typeof cp.loadScoped !== 'function') return null
      return await cp.loadScoped(params?.scope)
    }

    case 'connections.saveScoped': {
      const cp = selectedConnectionProvider()
      if (!cp || typeof cp.saveScoped !== 'function') return false
      await cp.saveScoped(params?.scope, params?.data)
      return true
    }

    case 'connections.resolveScoped': {
      const cp = selectedConnectionProvider()
      if (!cp || typeof cp.resolveScoped !== 'function') return null
      return await cp.resolveScoped(params?.scope, params?.connId)
    }

    case 'connections.resolveLaunch': {
      const cp = selectedConnectionProvider()
      if (!cp || typeof cp.resolveLaunch !== 'function') return null
      return await cp.resolveLaunch(params?.scope, params?.connId)
    }

    default:
      throw new Error(`Unknown RPC method "${method}"`)
  }
})
