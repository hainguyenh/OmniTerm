import fs from 'node:fs'
import path from 'node:path'
import type {
  Connection,
  ConnectionLaunchSpec,
  ConnectionScope,
  ConnectionTree,
  Folder,
} from './types'

const HEADER = ':: OMNITERM_CONNECTION_V1 '
const FOLDERS_HEADER = ':: OMNITERM_FOLDERS_V1 '
const FOLDERS_FILE = '_omniterm-folders.bat'
const SAFE_HOST = /^[A-Za-z0-9._:[\]-]+$/
const SAFE_USER = /^[A-Za-z0-9._@\\-]+$/
const SAFE_ID = /^[A-Za-z0-9._-]+$/

function validate(connection: Connection): void {
  if (!SAFE_ID.test(connection.id)) throw new Error('Connection id contains unsafe characters.')
  if (connection.type !== 'SSH' && connection.type !== 'RDP') {
    throw new Error('Limited Connections supports SSH and RDP only.')
  }
  if (!connection.host || !SAFE_HOST.test(connection.host)) {
    throw new Error('Host contains characters that are unsafe in a Windows launcher.')
  }
  if (connection.user && !SAFE_USER.test(connection.user)) {
    throw new Error('Username contains characters that are unsafe in a Windows launcher.')
  }
  const port = Number(connection.port || (connection.type === 'SSH' ? 22 : 3389))
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.')
  if (/[\r\n\0]/.test(connection.name)) throw new Error('Connection name contains a control character.')
  if (connection.passwordHelpUrl) {
    let parsed: URL
    try {
      parsed = new URL(connection.passwordHelpUrl)
    } catch {
      throw new Error('Password help link must be a valid HTTPS URL.')
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('Password help link must use HTTPS and must not contain credentials.')
    }
  }
}

function slug(value: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return result || 'connection'
}

function metadataLine(connection: Connection): string {
  return HEADER + Buffer.from(JSON.stringify(connection), 'utf8').toString('base64')
}

function launcherName(connection: Connection): string {
  return `${slug(connection.name)}-${connection.id.slice(0, 8)}.bat`
}

function validateFolders(folders: Folder[]): void {
  const ids = new Set<string>()
  for (const folder of folders) {
    if (!SAFE_ID.test(folder.id)) throw new Error('Folder id contains unsafe characters.')
    if (!folder.name.trim() || /[\r\n\0]/.test(folder.name)) {
      throw new Error('Folder name contains unsupported characters.')
    }
    if (ids.has(folder.id)) throw new Error('Folder ids must be unique.')
    ids.add(folder.id)
  }
  for (const folder of folders) {
    if (folder.parentId && !ids.has(folder.parentId)) throw new Error('Folder parent does not exist.')
  }
}

export function renderBatch(connection: Connection): string {
  validate(connection)
  const title = connection.name.replace(/[&|<>^%!"]/g, '').slice(0, 80)
  const lines = ['@echo off', metadataLine(connection), `title OmniTerm - ${title}`]
  if (connection.type === 'SSH') {
    const port = connection.port || '22'
    const destination = connection.user ? `${connection.user}@${connection.host}` : connection.host
    lines.push(
      `ssh.exe -o BatchMode=no -o PubkeyAuthentication=no -o GSSAPIAuthentication=no -o PreferredAuthentications=keyboard-interactive,password -p ${port} -- "${destination}"`,
      'exit /b %ERRORLEVEL%',
    )
  } else {
    const port = connection.port || '3389'
    lines.push(
      `mstsc.exe /v:"${connection.host}:${port}" /public /prompt`,
      'exit /b %ERRORLEVEL%',
    )
  }
  return `${lines.join('\r\n')}\r\n`
}

function renderFolders(folders: Folder[]): string {
  validateFolders(folders)
  const encoded = Buffer.from(JSON.stringify(folders), 'utf8').toString('base64')
  return `@echo off\r\n${FOLDERS_HEADER}${encoded}\r\nexit /b 0\r\n`
}

function parseFolders(file: string): Folder[] {
  try {
    if (!fs.existsSync(file)) return []
    const encoded = fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .find((line) => line.startsWith(FOLDERS_HEADER))
      ?.slice(FOLDERS_HEADER.length)
    if (!encoded) return []
    const folders = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Folder[]
    validateFolders(folders)
    return folders
  } catch {
    return []
  }
}

function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporary, file)
}

function parseLauncher(file: string): Connection | null {
  try {
    const firstLines = fs.readFileSync(file, 'utf8').split(/\r?\n/, 4)
    const encoded = firstLines.find((line) => line.startsWith(HEADER))?.slice(HEADER.length)
    if (!encoded) return null
    const connection = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Connection
    validate(connection)
    return connection
  } catch {
    return null
  }
}

export class BatchConnectionStore {
  constructor(private readonly personalDir: string) {}

  private dir(scope: ConnectionScope): string {
    return scope.kind === 'personal'
      ? path.join(this.personalDir, 'launchers')
      : path.join(scope.workspacePath, '.omniterm', 'launchers')
  }

  private entries(scope: ConnectionScope): Array<{ connection: Connection; file: string }> {
    const dir = this.dir(scope)
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith('.bat'))
      .map((name) => {
        const file = path.join(dir, name)
        return { connection: parseLauncher(file), file }
      })
      .filter((entry): entry is { connection: Connection; file: string } => entry.connection !== null)
  }

  load(scope: ConnectionScope): ConnectionTree {
    const dir = this.dir(scope)
    return {
      connections: this.entries(scope).map((entry) => entry.connection),
      folders: parseFolders(path.join(dir, FOLDERS_FILE)),
    }
  }

  save(scope: ConnectionScope, tree: ConnectionTree): void {
    const dir = this.dir(scope)
    validateFolders(tree.folders)
    atomicWrite(path.join(dir, FOLDERS_FILE), renderFolders(tree.folders))
    const wanted = new Set(tree.connections.map((connection) => connection.id))
    for (const entry of this.entries(scope)) {
      if (!wanted.has(entry.connection.id)) {
        fs.rmSync(entry.file, { force: true })
        fs.rmSync(entry.file.replace(/\.bat$/i, '.rdp'), { force: true })
      }
    }
    for (const connection of tree.connections) {
      validate(connection)
      for (const old of this.entries(scope).filter((entry) => entry.connection.id === connection.id)) {
        fs.rmSync(old.file, { force: true })
        fs.rmSync(old.file.replace(/\.bat$/i, '.rdp'), { force: true })
      }
      const bat = path.join(dir, launcherName(connection))
      atomicWrite(bat, renderBatch(connection))
    }
  }

  resolve(scope: ConnectionScope, id: string): Connection | null {
    return this.entries(scope).find((entry) => entry.connection.id === id)?.connection ?? null
  }

  resolveLaunch(scope: ConnectionScope, id: string): ConnectionLaunchSpec | null {
    const entry = this.entries(scope).find((candidate) => candidate.connection.id === id)
    if (!entry) return null
    return {
      kind: 'batch',
      path: entry.file,
      presentation: entry.connection.type === 'SSH' ? 'terminal' : 'detached',
    }
  }
}

export type { Folder }
