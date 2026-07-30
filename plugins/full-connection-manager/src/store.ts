/**
 * Metadata-only connection store for the Full Remote Suite.
 *
 * The existing encrypted file format is retained so upgrades do not lose connection profiles. Every
 * object is rebuilt from an explicit metadata allowlist before it is returned or written. Opening an
 * older file therefore rewrites it without unknown fields that previous versions may have persisted.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Connection, ConnectionTree, Folder, LocalShell } from './types'

const ALGO = 'aes-256-gcm'
const BASE_SECRET = 'omniterm-connection-manager/v1'
const CONNECTION_TYPES = new Set<Connection['type']>(['SSH', 'RDP', 'LOCAL'])
const LOCAL_SHELLS = new Set<LocalShell>(['wsl', 'powershell', 'cmd', 'default', 'zsh', 'bash', 'sh'])

type StoreData = { connections: Connection[]; folders: Folder[] }

function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(BASE_SECRET, salt, 32, { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

function safeHelpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? value : undefined
  } catch {
    return undefined
  }
}

function sanitizeConnection(value: unknown): Connection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (
    typeof source.id !== 'string' ||
    typeof source.name !== 'string' ||
    typeof source.type !== 'string' ||
    !CONNECTION_TYPES.has(source.type as Connection['type'])
  ) return null

  const connection: Connection = {
    id: source.id,
    name: source.name,
    type: source.type as Connection['type'],
    host: typeof source.host === 'string' ? source.host : '',
    port: typeof source.port === 'string' ? source.port : '',
    user: typeof source.user === 'string' ? source.user : '',
  }

  const helpUrl = safeHelpUrl(source.passwordHelpUrl)
  if (helpUrl) connection.passwordHelpUrl = helpUrl
  if (typeof source.parentId === 'string') connection.parentId = source.parentId
  if (typeof source.redirectDrives === 'boolean') connection.redirectDrives = source.redirectDrives
  if (typeof source.shell === 'string' && LOCAL_SHELLS.has(source.shell as LocalShell)) {
    connection.shell = source.shell as LocalShell
  }
  if (typeof source.localArgs === 'string') connection.localArgs = source.localArgs
  if (typeof source.localCwd === 'string') connection.localCwd = source.localCwd
  if (typeof source.localCommand === 'string') connection.localCommand = source.localCommand
  if (typeof source.localKeepOpen === 'boolean') connection.localKeepOpen = source.localKeepOpen
  return connection
}

function sanitizeFolder(value: unknown): Folder | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (typeof source.id !== 'string' || typeof source.name !== 'string') return null
  const folder: Folder = { id: source.id, name: source.name }
  if (typeof source.parentId === 'string') folder.parentId = source.parentId
  return folder
}

export class ConnectionStore {
  private readonly file: string
  private readonly saltFile: string
  private data: StoreData = { connections: [], folders: [] }

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'connections.enc')
    this.saltFile = path.join(dir, 'salt.bin')
    this.read()
  }

  private salt(): Buffer {
    try { return fs.readFileSync(this.saltFile) } catch { /* create below */ }
    const salt = crypto.randomBytes(16)
    fs.writeFileSync(this.saltFile, salt)
    return salt
  }

  private read(): void {
    try {
      const buf = fs.readFileSync(this.file)
      const iv = buf.subarray(0, 12)
      const tag = buf.subarray(12, 28)
      const ciphertext = buf.subarray(28)
      const decipher = crypto.createDecipheriv(ALGO, deriveKey(this.salt()), iv)
      decipher.setAuthTag(tag)
      const parsed = JSON.parse(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
      ) as { connections?: unknown[]; folders?: unknown[] }
      const originalConnections = Array.isArray(parsed.connections) ? parsed.connections : []
      const originalFolders = Array.isArray(parsed.folders) ? parsed.folders : []
      const connections = originalConnections
        .map(sanitizeConnection)
        .filter((connection): connection is Connection => connection !== null)
      const folders = originalFolders
        .map(sanitizeFolder)
        .filter((folder): folder is Folder => folder !== null)
      this.data = { connections, folders }

      // Rewrite once whenever an older file contains anything outside the current metadata schema.
      if (
        JSON.stringify(originalConnections) !== JSON.stringify(connections) ||
        JSON.stringify(originalFolders) !== JSON.stringify(folders)
      ) this.persist()
    } catch {
      this.data = { connections: [], folders: [] }
    }
  }

  private persist(): void {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(ALGO, deriveKey(this.salt()), iv)
    const plaintext = JSON.stringify(this.data)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    fs.writeFileSync(this.file, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]))
  }

  loadTree(): ConnectionTree {
    return {
      folders: this.data.folders.map((folder) => ({ ...folder })),
      connections: this.data.connections.map((connection) => ({ ...connection })),
    }
  }

  saveTree(tree: ConnectionTree): void {
    this.data = {
      folders: tree.folders
        .map(sanitizeFolder)
        .filter((folder): folder is Folder => folder !== null),
      connections: tree.connections
        .map(sanitizeConnection)
        .filter((connection): connection is Connection => connection !== null),
    }
    this.persist()
  }

  resolveRaw(id: string): Connection | null {
    const connection = this.data.connections.find((item) => item.id === id)
    return connection ? { ...connection } : null
  }
}

export { sanitizeConnection, sanitizeFolder }
