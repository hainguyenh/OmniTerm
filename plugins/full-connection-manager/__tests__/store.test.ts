import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { ConnectionStore } from '../src/store'

let dir: string
const ssh = (over = {}) => ({ id: 'a', name: 'web', type: 'SSH' as const, host: '10.0.0.1', port: '22', user: 'root', ...over })

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

function readStore(): unknown {
  const salt = fs.readFileSync(path.join(dir, 'salt.bin'))
  const buf = fs.readFileSync(path.join(dir, 'connections.enc'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(salt), buf.subarray(0, 12))
  decipher.setAuthTag(buf.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8'))
}

beforeEach(() => {
  dir = path.join(os.tmpdir(), `omniterm-cm-test-${crypto.randomBytes(6).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('ConnectionStore', () => {
  it('persists and reloads metadata-only profiles', () => {
    const store = new ConnectionStore(dir)
    store.saveTree({ folders: [{ id: 'f', name: 'prod' }], connections: [ssh()] })

    const reopened = new ConnectionStore(dir)
    expect(reopened.loadTree()).toEqual({
      folders: [{ id: 'f', name: 'prod' }],
      connections: [ssh()],
    })
  })

  it('strips secret-shaped fields from incoming data before persistence', () => {
    const store = new ConnectionStore(dir)
    store.saveTree({
      folders: [],
      connections: [ssh({ password: 'hunter2', hasStoredCredential: true, passwd: 'also-secret', token: 'token-secret' }) as never],
    })

    expect(store.resolveRaw('a')).toEqual(ssh())
    expect(JSON.stringify(readStore())).not.toContain('hunter2')
    expect(JSON.stringify(readStore())).not.toContain('hasStoredCredential')
    expect(JSON.stringify(readStore())).not.toContain('also-secret')
    expect(JSON.stringify(readStore())).not.toContain('token-secret')
  })

  it('scrubs legacy password fields when an old encrypted store is opened', () => {
    writeStore({
      folders: [{ id: 'f', name: 'prod', password: 'folder-secret' }],
      connections: [ssh({ password: 'legacy-secret', credentialMode: 'store', hasStoredSecret: true })],
    })

    const store = new ConnectionStore(dir)
    expect(store.resolveRaw('a')).toEqual(ssh())

    const rewritten = JSON.stringify(readStore())
    expect(rewritten).not.toContain('legacy-secret')
    expect(rewritten).not.toContain('credentialMode')
    expect(rewritten).not.toContain('hasStoredSecret')
    expect(rewritten).not.toContain('folder-secret')
  })
})
