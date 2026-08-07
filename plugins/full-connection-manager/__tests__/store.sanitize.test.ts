/**
 * Branch-level cover for the metadata allowlist.
 *
 * `store.test.ts` drives the store through its public surface, which only ever hands it well-formed
 * profiles. Everything here is the rejection half: the shapes an older or hand-edited file can hold
 * that must not reach the renderer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { ConnectionStore, sanitizeConnection, sanitizeFolder } from '../src/store'

let dir: string

function keyFor(salt: Buffer): Buffer {
  return crypto.scryptSync('omniterm-connection-manager/v1', salt, 32, {
    N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  })
}

function writeStore(value: unknown): void {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(salt), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  fs.writeFileSync(path.join(dir, 'salt.bin'), salt)
  fs.writeFileSync(path.join(dir, 'connections.enc'), Buffer.concat([iv, cipher.getAuthTag(), ciphertext]))
}

beforeEach(() => {
  dir = path.join(os.tmpdir(), `omniterm-cm-sanitize-${crypto.randomBytes(6).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('sanitizeConnection', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'connection'],
    ['a number', 7],
    ['an array', [{ id: 'a', name: 'web', type: 'SSH' }]],
  ])('rejects %s', (_label, value) => {
    expect(sanitizeConnection(value)).toBeNull()
  })

  it.each([
    ['a non-string id', { id: 1, name: 'web', type: 'SSH' }],
    ['a non-string name', { id: 'a', name: 1, type: 'SSH' }],
    ['a non-string type', { id: 'a', name: 'web', type: 1 }],
    ['a type outside the allowlist', { id: 'a', name: 'web', type: 'TELNET' }],
  ])('rejects %s', (_label, value) => {
    expect(sanitizeConnection(value)).toBeNull()
  })

  it('defaults host, port and user when they are not strings', () => {
    expect(sanitizeConnection({ id: 'a', name: 'web', type: 'LOCAL', host: 1, port: null, user: {} }))
      .toEqual({ id: 'a', name: 'web', type: 'LOCAL', host: '', port: '', user: '' })
  })

  it('keeps every optional metadata field that carries the right type', () => {
    expect(sanitizeConnection({
      id: 'a',
      name: 'shell',
      type: 'LOCAL',
      host: 'h',
      port: '22',
      user: 'u',
      parentId: 'f',
      redirectDrives: true,
      shell: 'powershell',
      localArgs: '-NoLogo',
      localCwd: 'C:/tmp',
      localCommand: 'echo hi',
      localKeepOpen: false,
    })).toEqual({
      id: 'a',
      name: 'shell',
      type: 'LOCAL',
      host: 'h',
      port: '22',
      user: 'u',
      parentId: 'f',
      redirectDrives: true,
      shell: 'powershell',
      localArgs: '-NoLogo',
      localCwd: 'C:/tmp',
      localCommand: 'echo hi',
      localKeepOpen: false,
    })
  })

  it('drops every optional metadata field whose type is wrong', () => {
    expect(sanitizeConnection({
      id: 'a',
      name: 'shell',
      type: 'LOCAL',
      parentId: 1,
      redirectDrives: 'yes',
      shell: 'fish',
      localArgs: 1,
      localCwd: [],
      localCommand: {},
      localKeepOpen: 'no',
    })).toEqual({ id: 'a', name: 'shell', type: 'LOCAL', host: '', port: '', user: '' })
  })

  it.each([
    ['a non-string', 42],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['an unparseable URL', 'not a url'],
    ['plain http', 'http://vault.example/help'],
    ['a URL carrying a username', 'https://user@vault.example/help'],
    ['a URL carrying a password', 'https://user:pw@vault.example/help'],
  ])('drops a password help URL that is %s', (_label, passwordHelpUrl) => {
    const result = sanitizeConnection({ id: 'a', name: 'web', type: 'SSH', passwordHelpUrl })
    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('passwordHelpUrl')
  })
})

describe('sanitizeFolder', () => {
  it.each([
    ['null', null],
    ['a string', 'folder'],
    ['an array', []],
    ['a non-string id', { id: 1, name: 'prod' }],
    ['a non-string name', { id: 'f', name: 1 }],
  ])('rejects %s', (_label, value) => {
    expect(sanitizeFolder(value)).toBeNull()
  })

  it('keeps parentId only when it is a string', () => {
    expect(sanitizeFolder({ id: 'f', name: 'prod', parentId: 'root' }))
      .toEqual({ id: 'f', name: 'prod', parentId: 'root' })
    expect(sanitizeFolder({ id: 'f', name: 'prod', parentId: 7 }))
      .toEqual({ id: 'f', name: 'prod' })
  })
})

describe('ConnectionStore file handling', () => {
  it('reads an empty tree when the file does not exist', () => {
    expect(new ConnectionStore(dir).loadTree()).toEqual({ connections: [], folders: [] })
  })

  it('reads an empty tree when the file is not decryptable', () => {
    fs.writeFileSync(path.join(dir, 'connections.enc'), crypto.randomBytes(64))
    expect(new ConnectionStore(dir).loadTree()).toEqual({ connections: [], folders: [] })
  })

  it('treats non-array connections and folders as empty', () => {
    writeStore({ connections: 'nope', folders: { id: 'f' } })
    expect(new ConnectionStore(dir).loadTree()).toEqual({ connections: [], folders: [] })
  })

  it('leaves an already-clean file untouched on open', () => {
    const store = new ConnectionStore(dir)
    store.saveTree({ folders: [{ id: 'f', name: 'prod' }], connections: [] })
    const before = fs.readFileSync(path.join(dir, 'connections.enc'))

    // A file that survives the allowlist unchanged must not be rewritten — the ciphertext would
    // differ on every open because `persist` mints a fresh IV.
    new ConnectionStore(dir)
    expect(fs.readFileSync(path.join(dir, 'connections.enc')).equals(before)).toBe(true)
  })

  it('reuses an existing salt rather than minting a second one', () => {
    new ConnectionStore(dir).saveTree({ folders: [], connections: [] })
    const salt = fs.readFileSync(path.join(dir, 'salt.bin'))
    new ConnectionStore(dir).saveTree({ folders: [], connections: [] })
    expect(fs.readFileSync(path.join(dir, 'salt.bin')).equals(salt)).toBe(true)
  })

  it('creates the storage directory when it is missing', () => {
    const nested = path.join(dir, 'a', 'b')
    expect(new ConnectionStore(nested).loadTree()).toEqual({ connections: [], folders: [] })
    expect(fs.existsSync(nested)).toBe(true)
  })

  it('drops unusable entries from a saved tree', () => {
    const store = new ConnectionStore(dir)
    store.saveTree({
      folders: [{ id: 'f', name: 'prod' }, null as never],
      connections: [{ id: 'a', name: 'web', type: 'TELNET' } as never],
    })
    expect(store.loadTree()).toEqual({ folders: [{ id: 'f', name: 'prod' }], connections: [] })
    expect(store.resolveRaw('a')).toBeNull()
  })
})
