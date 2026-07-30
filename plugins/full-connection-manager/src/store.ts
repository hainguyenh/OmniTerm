/**
 * Encrypted-at-rest connection store for the connection-manager plugin.
 *
 * The host requires no login, so the tree is encrypted with a key derived from a built-in plugin
 * secret + a per-install random salt (obfuscation-at-rest — deters casual disk inspection, not a
 * cryptographic secret against someone who also holds the plugin binary). Files live in the
 * plugin's private `storageDir` provided by the host.
 *
 * Per-connection credential mode:
 *   'none'  — no password kept; resolve returns the connection without one (the user types it).
 *   'url'   — password lives elsewhere; on resolve the plugin opens `passwordUrl` so the user can copy
 *             it, and returns the connection without a password.
 *   'store' — password held by the injected `CredentialStore` and returned on resolve.
 *
 * **'store' is unavailable in the stock host**, which supplies a `CredentialStore` that refuses every
 * write: OmniTerm holds no password, in any form. `setCredential` rejects a request for it rather than
 * accepting one and keeping nothing. The mode remains because a deployment may inject its own store —
 * in which case protecting what that store writes is the deployment's responsibility.
 *
 * Note what this file's own encryption is and is not: the key comes from a constant compiled into the
 * plugin plus a salt stored beside the ciphertext, so it deters casual disk inspection and nothing more.
 * It is not a place to put a secret.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Connection, ConnectionTree, CredentialStore, Folder, ResolvedConnection } from './types'

const ALGO = 'aes-256-gcm'
const BASE_SECRET = 'omniterm-connection-manager/v1'

export type CredentialMode = 'store' | 'none' | 'url'
export type StoredConnection = Connection & {
  credentialMode?: CredentialMode
  passwordUrl?: string
  hasStoredSecret?: boolean
  /**
   * Legacy v1 field, moved to HostServices.credentials during initialize().
   *
   * It survives that migration only when there is nowhere to move it to, which is the stock
   * configuration — the host stores no secrets. Its mere presence is what `pendingMigrations()` reports,
   * so the user can clear it deliberately instead of losing it silently.
   */
  password?: string
}

/** Outcome of a credential write. A bare `false` could not say *why*, which mattered once the host
 * started refusing storage outright — the UI needs to tell the user to pick 'none' or 'url'. */
export type CredentialResult = { ok: boolean; error?: string }
type StoreData = { connections: StoredConnection[]; folders: Folder[] }

function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(BASE_SECRET, salt, 32, { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

/**
 * Drop plugin-only metadata AND any secret, so the result is a plain contract `Connection`.
 *
 * `password` is destructured out by name rather than left to the type system: `Connection` has no
 * such field, but TypeScript permits returning a wider object where a narrower one is declared, so
 * an un-named secret would type-check its way into the host's renderer-facing tree.
 */
function stripMeta(c: StoredConnection): Connection {
  const {
    credentialMode: _m,
    passwordUrl: _u,
    hasStoredSecret: _h,
    password: _p,
    ...rest
  } = c
  return { ...rest, hasStoredCredential: !!c.hasStoredSecret }
}

/** Like `stripMeta`, but keeps the resolved secret. Main-process only — never sent to a renderer. */
function stripMetaKeepingSecret(c: StoredConnection): ResolvedConnection {
  const { credentialMode: _m, passwordUrl: _u, hasStoredSecret: _h, ...rest } = c
  return { ...rest, hasStoredCredential: !!c.hasStoredSecret }
}

export class ConnectionStore {
  private readonly file: string
  private readonly saltFile: string
  private readonly credentials: CredentialStore
  private data: StoreData = { connections: [], folders: [] }

  constructor(dir: string, credentials: CredentialStore) {
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'connections.enc')
    this.saltFile = path.join(dir, 'salt.bin')
    this.credentials = credentials
    this.read()
  }

  private credentialKey(id: string): string {
    return `connection:${id}`
  }

  /**
   * Store a secret and confirm it can be read back, returning false if either step fails.
   *
   * The read-back is not paranoia — it is the invariant that makes migration safe. A `set` that
   * resolves is not evidence of a write: the host's used to resolve with `null` while storing nothing,
   * and any third-party `CredentialStore` can have the same bug. Since the caller deletes its only
   * copy of the plaintext on success, "resolved" is too weak a signal to act on. Retrieving the exact
   * value back is the only proof that deleting the original is safe.
   */
  private async storeSecret(id: string, value: string): Promise<boolean> {
    if (!this.credentials.isAvailable()) return false
    const key = this.credentialKey(id)
    try {
      await this.credentials.set(key, value)
      return (await this.credentials.get(key)) === value
    } catch {
      return false
    }
  }

  /**
   * Move passwords written by the legacy built-in-key store into the host's credential storage.
   *
   * The plaintext field is deleted ONLY once the secret has been stored *and read back*. The first
   * version deleted it unconditionally against a `set` that silently resolved without storing
   * anything, so migrating a password *destroyed* it rather than moving it. When storage is
   * unavailable — the stock configuration, since OmniTerm holds no secrets — the plaintext is left
   * exactly where it already is. Leaving a secret in a file the user already has is strictly better
   * than deleting the only copy of it they have.
   *
   * Nothing is written unless a migration succeeded, and that write only ever *removes* a secret. A
   * blocked migration deliberately persists no marker: recording one would mean rewriting a file that
   * still contains the plaintext, and `pendingMigrations()` can see the same thing without it.
   */
  async initialize(): Promise<void> {
    let migrated = false
    for (const connection of this.data.connections) {
      if (!connection.password) continue
      if (!(await this.storeSecret(connection.id, connection.password))) continue

      connection.hasStoredSecret = true
      delete connection.password
      migrated = true
    }
    if (migrated) this.persist()
  }

  /**
   * Connections still holding an un-migrated plaintext password, as ids and names only.
   *
   * Renderer-safe by construction: it returns no secret, so it can back a UI prompt asking the user to
   * re-enter the password against credentialMode 'none', or point it at a vault with 'url'.
   */
  pendingMigrations(): Array<{ id: string; name: string }> {
    return this.data.connections
      .filter((c) => !!c.password)
      .map((c) => ({ id: c.id, name: c.name }))
  }

  private salt(): Buffer {
    try { return fs.readFileSync(this.saltFile) } catch { /* create below */ }
    const s = crypto.randomBytes(16)
    try { fs.writeFileSync(this.saltFile, s) } catch { /* best effort */ }
    return s
  }

  private read(): void {
    try {
      const buf = fs.readFileSync(this.file)
      const iv = buf.subarray(0, 12)
      const tag = buf.subarray(12, 28)
      const ct = buf.subarray(28)
      const decipher = crypto.createDecipheriv(ALGO, deriveKey(this.salt()), iv)
      decipher.setAuthTag(tag)
      const txt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
      const parsed = JSON.parse(txt) as Partial<StoreData>
      this.data = { connections: parsed.connections ?? [], folders: parsed.folders ?? [] }
    } catch {
      this.data = { connections: [], folders: [] }
    }
  }

  private persist(): void {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(ALGO, deriveKey(this.salt()), iv)
    const ct = Buffer.concat([cipher.update(JSON.stringify(this.data), 'utf8'), cipher.final()])
    fs.writeFileSync(this.file, Buffer.concat([iv, cipher.getAuthTag(), ct]))
  }

  /** Renderer-safe tree. `Connection` has no credential field, so this cannot carry a secret. */
  loadTree(): ConnectionTree {
    return {
      folders: this.data.folders,
      connections: this.data.connections.map(stripMeta),
    }
  }

  /**
   * Persist an edited tree.
   *
   * Metadata only: the host's tree cannot express a credential, so a password never arrives here.
   * Secrets enter through `setCredential()`, which the plugin's own renderer surface calls — keeping
   * the one path that writes a secret separate from the one the host drives.
   */
  async saveTree(tree: ConnectionTree): Promise<void> {
    const prev = new Map(this.data.connections.map((c) => [c.id, c]))
    const nextIds = new Set(tree.connections.map((c) => c.id))
    // A connection the user deleted takes its stored secret with it.
    for (const old of this.data.connections) {
      if (!nextIds.has(old.id)) await this.credentials.delete(this.credentialKey(old.id))
    }
    this.data.folders = tree.folders
    this.data.connections = tree.connections.map((incoming) => {
      const { hasStoredCredential: _indicator, ...metadata } = incoming
      return {
        ...(prev.get(incoming.id) ?? {}),
        ...metadata,
      }
    })
    this.persist()
  }

  /** Full connection (incl. secret + metadata) for a saved id, or null. */
  async resolveRaw(id: string): Promise<StoredConnection | null> {
    const c = this.data.connections.find((x) => x.id === id)
    if (!c) return null
    const resolved = { ...c }
    if ((c.credentialMode ?? 'store') === 'store' && c.hasStoredSecret) {
      resolved.password = await this.credentials.get(this.credentialKey(id))
    }
    return resolved
  }

  /**
   * Set the credential mode / stored password / password URL for a connection.
   *
   * Refuses anything that would need storage the host does not have, rather than accepting it and
   * quietly keeping nothing. Clearing a secret always succeeds — "make sure nothing is stored" needs
   * no backing store.
   */
  async setCredential(
    id: string,
    cfg: { mode?: CredentialMode; password?: string; passwordUrl?: string },
  ): Promise<CredentialResult> {
    const c = this.data.connections.find((x) => x.id === id)
    if (!c) return { ok: false, error: `Unknown connection "${id}".` }

    const wantsStorage = cfg.mode === 'store' || !!cfg.password
    if (wantsStorage && !this.credentials.isAvailable()) {
      return {
        ok: false,
        error:
          'No credential storage is available. Use mode "none" to type the password per session, or ' +
          '"url" to point at where it is kept.',
      }
    }

    if (cfg.mode) {
      c.credentialMode = cfg.mode
      if (cfg.mode !== 'store') {
        await this.credentials.delete(this.credentialKey(id))
        c.hasStoredSecret = false
      }
    }
    if (cfg.passwordUrl !== undefined) c.passwordUrl = cfg.passwordUrl

    if (cfg.password !== undefined) {
      if (cfg.password) {
        // Do not record a secret the store did not actually take — `hasStoredSecret` drives
        // `resolve()`, so a false positive here means a connect attempt with no password.
        if (!(await this.storeSecret(id, cfg.password))) {
          return { ok: false, error: 'The credential store did not retain the password.' }
        }
        c.hasStoredSecret = true
        // A password supplied now supersedes any un-migrated legacy plaintext.
        delete c.password
      } else {
        await this.credentials.delete(this.credentialKey(id))
        c.hasStoredSecret = false
        delete c.password
      }
    }

    this.persist()
    return { ok: true }
  }

  /** Mark a credential written by the host's native prompt without carrying it through JavaScript. */
  async confirmStoredCredential(id: string): Promise<CredentialResult> {
    const c = this.data.connections.find((connection) => connection.id === id)
    if (!c) return { ok: false, error: `Unknown connection "${id}".` }
    if (!(await this.credentials.get(this.credentialKey(id)))) {
      return { ok: false, error: 'Windows Credential Manager did not retain the credential.' }
    }
    c.credentialMode = 'store'
    c.hasStoredSecret = true
    delete c.password
    this.persist()
    return { ok: true }
  }
}

export { stripMeta, stripMetaKeepingSecret }
