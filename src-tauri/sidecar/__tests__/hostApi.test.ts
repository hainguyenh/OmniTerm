/**
 * Tests for the sidecar's HostAPI — the single boundary where a plugin touches the host.
 *
 * Two things are pinned here. First, that the manifest's `permissions` array is actually enforced: it
 * used to be parsed into the descriptor and never read, so every plugin held every capability and the
 * field was decoration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const { HostAPIImpl, requirePermission, KNOWN_PERMISSIONS } = require_('../host-api.cjs')

let appDataDir: string

/** Stands in for JsonRpcProtocol; records what would have gone over stdio. */
function fakeProtocol() {
  const calls: Array<{ method: string; params: unknown }> = []
  return {
    calls,
    callRemote: async (method: string, params: unknown) => {
      calls.push({ method, params })
      return null
    },
    sendNotification: (method: string, params: unknown) => {
      calls.push({ method, params })
    },
  }
}

const registry = () => ({
  descriptors: new Map(),
  connectionProviders: new Map(),
  authProviders: new Map(),
  workspaceProviders: new Map(),
  invokeHandlers: new Map(),
  updateStatus: () => {},
})

const hostFor = (permissions: string[]) =>
  new HostAPIImpl(
    { id: '@test/p', version: '1.0.0', permissions },
    appDataDir,
    fakeProtocol(),
    registry(),
  )

beforeEach(() => {
  appDataDir = path.join(os.tmpdir(), 'omniterm-sidecar-test-' + crypto.randomBytes(6).toString('hex'))
  fs.mkdirSync(appDataDir, { recursive: true })
})
afterEach(() => {
  try { fs.rmSync(appDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('permission enforcement', () => {
  const registrations = [
    ['registerConnectionProvider', 'connections', {}],
    ['registerAuthProvider', 'auth', { gate: () => true }],
    ['registerWorkspaceProvider', 'workspace', {}],
    ['registerInvokeHandler', 'renderer', () => null],
  ] as const

  for (const [method, permission, arg] of registrations) {
    it(`${method}() requires "${permission}"`, () => {
      const denied = hostFor([])
      expect(() => denied[method](arg)).toThrow(/"" ?|permission/i)
      // The message must name both the plugin and the permission to add — the author reads this.
      expect(() => denied[method](arg)).toThrow(/@test\/p/)
      expect(() => denied[method](arg)).toThrow(new RegExp(permission))

      // Declared: allowed.
      expect(() => hostFor([permission])[method](arg)).not.toThrow()
    })

    it(`${method}() is not unlocked by an unrelated permission`, () => {
      const other = KNOWN_PERMISSIONS.find((p: string) => p !== permission)
      expect(() => hostFor([other])[method](arg)).toThrow()
    })
  }

  it('services.openExternal() requires "openExternal"', async () => {
    await expect(hostFor([]).services.openExternal('https://vault.example/x')).rejects.toThrow(/openExternal/)
    await expect(hostFor(['openExternal']).services.openExternal('https://vault.example/x')).resolves.toBeUndefined()
  })

  it('services.writeClipboard() requires "clipboard"', async () => {
    await expect(hostFor([]).services.writeClipboard('x')).rejects.toThrow(/clipboard/)
    await expect(hostFor(['clipboard']).services.writeClipboard('x')).resolves.toBeUndefined()
  })


  it('declared permissions cannot be widened by the plugin at runtime', () => {
    const host = hostFor(['connections'])
    // A plugin that could edit its own permission array would be self-authorizing. Asserted as the
    // resulting state rather than a throw: a frozen object rejects writes silently in sloppy mode and
    // throws in strict mode, and the sidecar's .cjs modules are sloppy.
    try { host.plugin.permissions.push('auth') } catch { /* strict mode */ }
    try { (host.plugin as { permissions: string[] }).permissions = [...KNOWN_PERMISSIONS] } catch { /* strict */ }

    expect(host.plugin.permissions).toEqual(['connections'])
    expect(() => host.registerAuthProvider({ gate: () => true })).toThrow(/auth/)
  })

  it('requirePermission names the plugin, the permission, and where to add it', () => {
    expect(() => requirePermission('@a/b', [], 'openExternal', 'x()')).toThrow(/@a\/b/)
    expect(() => requirePermission('@a/b', [], 'openExternal', 'x()')).toThrow(/openExternal/)
    expect(() => requirePermission('@a/b', [], 'openExternal', 'x()')).toThrow(/omnitermPlugin\.permissions/)
  })
})

describe('plugin storage directory', () => {
  it('is created per plugin under the app data dir', () => {
    const host = hostFor([])
    expect(host.services.storageDir).toBe(path.join(appDataDir, 'plugin-storage', '@test_p'))
    expect(fs.existsSync(host.services.storageDir)).toBe(true)
  })

  it('needs no permission — it is the plugin\'s own space', () => {
    expect(() => hostFor([]).services.storageDir).not.toThrow()
  })

  /**
   * The regression that motivated moving it. Storage lived at `plugins/<id>/storage`, i.e. inside the
   * plugin's own install directory — and `install:plugin` replaces a plugin by deleting that directory
   * first, so upgrading a plugin destroyed its data. For the reference plugin that is the user's entire
   * connection tree.
   */
  it('is outside the directory an install would delete', () => {
    const installDir = path.join(appDataDir, 'plugins', '@test_p')
    const storageDir = hostFor([]).services.storageDir
    expect(path.resolve(storageDir).startsWith(path.resolve(installDir) + path.sep)).toBe(false)
    // Nor anywhere under the tree discovery walks, so plugin data and plugin code stay separate.
    const plugins = path.join(appDataDir, 'plugins')
    expect(path.resolve(storageDir).startsWith(path.resolve(plugins) + path.sep)).toBe(false)
  })

  it('carries data over from the legacy in-install location once', () => {
    const legacy = path.join(appDataDir, 'plugins', '@test_p', 'storage')
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'connections.enc'), 'ciphertext')

    const storageDir = hostFor([]).services.storageDir
    expect(fs.readFileSync(path.join(storageDir, 'connections.enc'), 'utf8')).toBe('ciphertext')
    expect(fs.existsSync(legacy)).toBe(false)
    // And no empty `plugins/<id>/` shell left in the tree discovery walks.
    expect(fs.existsSync(path.dirname(legacy))).toBe(false)
  })

  it('leaves an installed plugin in place when migrating its storage out', () => {
    const installDir = path.join(appDataDir, 'plugins', '@test_p')
    fs.mkdirSync(path.join(installDir, 'storage'), { recursive: true })
    fs.writeFileSync(path.join(installDir, 'package.json'), '{}')

    const host = hostFor([])
    // Emptying the storage directory must not take the plugin's own code with it.
    expect(fs.existsSync(path.join(installDir, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(installDir, 'storage'))).toBe(false)
    expect(fs.existsSync(host.services.storageDir)).toBe(true)
  })

  it('does not let a legacy directory overwrite storage already migrated', () => {
    const host = hostFor([])
    fs.writeFileSync(path.join(host.services.storageDir, 'connections.enc'), 'current')
    const legacy = path.join(appDataDir, 'plugins', '@test_p', 'storage')
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'connections.enc'), 'stale')

    const again = hostFor([])
    expect(fs.readFileSync(path.join(again.services.storageDir, 'connections.enc'), 'utf8')).toBe('current')
  })

  /**
   * The id is a package name, and it used to be joined into a path unsanitized. A scoped id created a
   * bare namespace directory, and a traversal segment would have placed storage outside the app's own
   * data directory entirely.
   */
  it('keeps a scoped or hostile id inside one directory segment', () => {
    for (const id of ['@acme/thing', '../../escape', 'a/b/c', 'has:colon']) {
      const host = new HostAPIImpl({ id, version: '1.0.0', permissions: [] }, appDataDir, fakeProtocol(), registry())
      const parent = path.join(appDataDir, 'plugin-storage')
      // Exactly one segment below the storage root. Separators are replaced, so '../../escape' collapses
      // to the single harmless name '.._.._escape' — the dots survive, the traversal does not.
      expect(path.relative(parent, host.services.storageDir).split(path.sep)).toHaveLength(1)
      // And the resolved path — after any '..' would have been applied — is still inside it.
      expect(path.resolve(host.services.storageDir).startsWith(path.resolve(parent) + path.sep)).toBe(true)
    }
  })
})
