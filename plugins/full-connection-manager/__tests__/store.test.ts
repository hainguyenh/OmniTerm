import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { ConnectionStore } from '../src/store'

let dir: string
let secrets: Map<string, string>

const credentialStore = () => ({
  isAvailable: () => true,
  get: async (key: string) => secrets.get(key),
  set: async (key: string, value: string) => { secrets.set(key, value) },
  delete: async (key: string) => { secrets.delete(key) },
})

/**
 * What the host actually hands a plugin: no storage at all. `set` rejects rather than resolving
 * without storing, which is the distinction the original bug turned on.
 */
const refusingStore = () => ({
  isAvailable: () => false,
  get: async () => undefined,
  set: async () => { throw new Error('OmniTerm provides no credential storage') },
  delete: async () => {},
})

/** The exact shape of the original defect: `set` resolves but stores nothing, and claims to work. */
const lyingStore = () => ({
  isAvailable: () => true,
  get: async () => undefined,
  set: async () => {},
  delete: async () => {},
})

/** Write a legacy v1 store file whose connection still carries a plaintext `password`. */
function writeLegacyStore(target: string, password: string): void {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync('omniterm-connection-manager/v1', salt, 32, {
    N: 2 ** 14,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = JSON.stringify({ folders: [], connections: [ssh({ password })] })
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  fs.writeFileSync(path.join(target, 'salt.bin'), salt)
  fs.writeFileSync(path.join(target, 'connections.enc'), Buffer.concat([iv, cipher.getAuthTag(), ciphertext]))
}

beforeEach(() => {
  dir = path.join(os.tmpdir(), 'omniterm-cm-test-' + crypto.randomBytes(6).toString('hex'))
  fs.mkdirSync(dir, { recursive: true })
  secrets = new Map()
})
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})

const ssh = (over = {}) => ({ id: 'a', name: 'web', type: 'SSH' as const, host: '10.0.0.1', port: '22', user: 'root', ...over })

describe('ConnectionStore', () => {
  it('persists encrypted metadata separately from the OS-backed secret and reloads it', async () => {
    const s = new ConnectionStore(dir, credentialStore())
    await s.saveTree({ folders: [{ id: 'f', name: 'prod' }], connections: [ssh()] })
    await s.setCredential('a', { password: 'hunter2' })

    const raw = fs.readFileSync(path.join(dir, 'connections.enc'))
    expect(raw.toString('utf8')).not.toContain('hunter2')
    expect(raw.toString('utf8')).not.toContain('10.0.0.1')
    expect(secrets.get('connection:a')).toBe('hunter2')

    const reopened = new ConnectionStore(dir, credentialStore())
    const tree = reopened.loadTree()
    expect(tree.folders).toHaveLength(1)
    expect(tree.connections[0].host).toBe('10.0.0.1')
  })

  /**
   * The host's tree cannot express a credential, so the only way one enters the store is
   * `setCredential`. That separation is the point: the path the host drives and the path that
   * writes a secret are different code, so a host-side change cannot start persisting one.
   */
  it('load() cannot carry a secret; resolve() returns it', async () => {
    const s = new ConnectionStore(dir, credentialStore())
    await s.saveTree({ folders: [], connections: [ssh()] })
    await s.setCredential('a', { password: 'hunter2' })

    const loaded = s.loadTree().connections[0] as Record<string, unknown>
    expect(loaded.password).toBeUndefined()
    expect(Object.keys(loaded)).not.toContain('password')
    expect((await s.resolveRaw('a'))?.password).toBe('hunter2')
  })

  it('a saveTree from the host preserves a secret it knows nothing about', async () => {
    const s = new ConnectionStore(dir, credentialStore())
    await s.saveTree({ folders: [], connections: [ssh()] })
    await s.setCredential('a', { password: 'hunter2' })

    // The user renames the connection; the host round-trips the tree with no notion of a password.
    await s.saveTree({ folders: [], connections: [ssh({ name: 'web2' })] })
    expect((await s.resolveRaw('a'))?.name).toBe('web2')
    expect((await s.resolveRaw('a'))?.password).toBe('hunter2')
  })

  it('deleting a connection takes its stored secret with it', async () => {
    const s = new ConnectionStore(dir, credentialStore())
    await s.saveTree({ folders: [], connections: [ssh()] })
    await s.setCredential('a', { password: 'hunter2' })

    await s.saveTree({ folders: [], connections: [] })
    expect(secrets.has('connection:a')).toBe(false)
  })

  it("credentialMode 'none' deletes the password", async () => {
    const s = new ConnectionStore(dir, credentialStore())
    await s.saveTree({ folders: [], connections: [ssh()] })
    await s.setCredential('a', { password: 'hunter2' })

    await s.setCredential('a', { mode: 'none' })
    expect(secrets.has('connection:a')).toBe(false)
    expect((await s.resolveRaw('a'))?.password).toBeUndefined()
  })

  it('an empty password clears the stored secret', async () => {
    const s = new ConnectionStore(dir, credentialStore())
    await s.saveTree({ folders: [], connections: [ssh()] })
    await s.setCredential('a', { password: 'hunter2' })

    await s.setCredential('a', { password: '' })
    expect(secrets.has('connection:a')).toBe(false)
  })

  it('setCredential stores a passwordUrl for the url convenience', async () => {
    const s = new ConnectionStore(dir, credentialStore())
    await s.saveTree({ folders: [], connections: [ssh()] })
    expect(await s.setCredential('a', { mode: 'url', passwordUrl: 'https://vault.example/x' })).toEqual({ ok: true })
    const raw = await s.resolveRaw('a')
    expect(raw?.credentialMode).toBe('url')
    expect(raw?.passwordUrl).toBe('https://vault.example/x')
  })

  /**
   * `exportAll` returned every connection *with* its password, and was reachable from the renderer
   * through `plugin.invoke` — the host returns an invoke result to the webview verbatim. It is gone;
   * this asserts nothing put it back, and that no invoke-reachable method yields a secret.
   */
  it('exposes no invoke-reachable method that returns a secret', async () => {
    const s = new ConnectionStore(dir, credentialStore()) as unknown as Record<string, unknown>
    expect(s.exportAll).toBeUndefined()

    const store = new ConnectionStore(dir, credentialStore())
    await store.saveTree({ folders: [], connections: [ssh()] })
    await store.setCredential('a', { password: 'hunter2' })
    // The two methods index.ts routes `plugin.invoke` to.
    expect(JSON.stringify(store.pendingMigrations())).not.toContain('hunter2')
    expect(JSON.stringify(await store.setCredential('a', { mode: 'none' }))).not.toContain('hunter2')
  })

  it('migrates a legacy embedded password when storage accepts it', async () => {
    writeLegacyStore(dir, 'legacy-secret')

    const store = new ConnectionStore(dir, credentialStore())
    await store.initialize()

    expect(secrets.get('connection:a')).toBe('legacy-secret')
    expect((await store.resolveRaw('a'))?.password).toBe('legacy-secret')
    expect(fs.readFileSync(path.join(dir, 'connections.enc')).toString('utf8')).not.toContain(
      'legacy-secret',
    )
    expect(store.pendingMigrations()).toEqual([])
  })

  /**
   * The regression that matters. `initialize()` used to `delete connection.password` unconditionally,
   * against a host `credentials.set` that resolved without storing anything — so migrating a password
   * destroyed it. Deleting the user's only copy of a secret is the worst outcome available here, so
   * both a refusing store and a lying one must leave the plaintext exactly where it was.
   */
  for (const [label, store] of [['refuses', refusingStore], ['silently stores nothing', lyingStore]] as const) {
    it(`keeps a legacy password when the credential store ${label}`, async () => {
      writeLegacyStore(dir, 'legacy-secret')

      const s = new ConnectionStore(dir, store())
      await s.initialize()

      // Still resolvable: the connection can still be used.
      expect((await s.resolveRaw('a'))?.password).toBe('legacy-secret')
      // Still on disk, so it survives a restart rather than living only in this process.
      const reopened = new ConnectionStore(dir, store())
      expect((await reopened.resolveRaw('a'))?.password).toBe('legacy-secret')
      // And surfaced, so the user is told to move it rather than finding out at connect time.
      expect(s.pendingMigrations()).toEqual([{ id: 'a', name: 'web' }])
    })
  }

  it('refuses to record a secret the store would not take', async () => {
    const s = new ConnectionStore(dir, refusingStore())
    await s.saveTree({ folders: [], connections: [ssh()] })

    const res = await s.setCredential('a', { password: 'hunter2' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no credential storage/i)
    // The flag that drives resolve() must not claim a secret exists.
    expect((await s.resolveRaw('a'))?.hasStoredSecret).toBeFalsy()
    expect((await s.resolveRaw('a'))?.password).toBeUndefined()
    expect(fs.readFileSync(path.join(dir, 'connections.enc')).toString('utf8')).not.toContain('hunter2')
  })

  it("allows the storage-free modes when no store is available", async () => {
    const s = new ConnectionStore(dir, refusingStore())
    await s.saveTree({ folders: [], connections: [ssh()] })

    expect(await s.setCredential('a', { mode: 'none' })).toEqual({ ok: true })
    expect(await s.setCredential('a', { mode: 'url', passwordUrl: 'https://vault.example/x' })).toEqual({ ok: true })
    // Clearing needs no backing store either.
    expect(await s.setCredential('a', { password: '' })).toEqual({ ok: true })
    // But asking for storage is refused.
    expect((await s.setCredential('a', { mode: 'store' })).ok).toBe(false)
  })

  it('a password entered later supersedes an un-migrated legacy one', async () => {
    writeLegacyStore(dir, 'legacy-secret')
    const s = new ConnectionStore(dir, refusingStore())
    await s.initialize()
    expect(s.pendingMigrations()).toHaveLength(1)

    // The user resolves it the storage-free way: no password kept at all.
    expect(await s.setCredential('a', { mode: 'none', password: '' })).toEqual({ ok: true })
    expect(s.pendingMigrations()).toEqual([])
    expect((await s.resolveRaw('a'))?.password).toBeUndefined()
    expect(fs.readFileSync(path.join(dir, 'connections.enc')).toString('utf8')).not.toContain('legacy-secret')
  })
})
