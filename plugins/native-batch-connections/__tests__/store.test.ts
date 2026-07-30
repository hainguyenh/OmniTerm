import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BatchConnectionStore, renderBatch } from '../src/store'
import type { Connection, ConnectionScope } from '../src/types'

let root: string
let store: BatchConnectionStore
const personal: ConnectionScope = { kind: 'personal' }

const ssh = (overrides: Partial<Connection> = {}): Connection => ({
  id: 'ssh-prod-1',
  name: 'Production SSH',
  type: 'SSH',
  host: 'server.example.com',
  port: '22',
  user: 'operator',
  ...overrides,
})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniterm-native-bat-'))
  store = new BatchConnectionStore(root)
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('Limited Connections launchers', () => {
  it('writes a metadata-bearing SSH launcher with an interactive native prompt', () => {
    store.save(personal, { connections: [ssh()], folders: [] })
    const launch = store.resolveLaunch(personal, 'ssh-prod-1')
    expect(launch?.presentation).toBe('terminal')
    const content = fs.readFileSync(launch!.path, 'utf8')
    expect(content).toContain(':: OMNITERM_CONNECTION_V1 ')
    expect(content).toContain('ssh.exe')
    expect(content).toContain('BatchMode=no')
    expect(content).not.toMatch(/password\s*[:=]/i)
    expect(store.load(personal).connections).toEqual([ssh()])
  })

  it('keeps only allowlisted metadata fields in launcher files', () => {
    const unsafe = {
      ...ssh(),
      password: 'must-not-persist',
      passwd: 'must-not-persist-either',
      token: 'must-not-persist-token',
    } as Connection
    store.save(personal, {
      connections: [unsafe],
      folders: [{ id: 'f', name: 'Folder', password: 'folder-secret' } as never],
    })

    const loaded = store.load(personal)
    expect(loaded.connections[0]).toEqual(ssh())
    expect(loaded.folders[0]).toEqual({ id: 'f', name: 'Folder' })
    const batch = fs.readFileSync(store.resolveLaunch(personal, 'ssh-prod-1')!.path, 'utf8')
    const marker = batch.split(/\r?\n/).find((line) => line.startsWith(':: OMNITERM_CONNECTION_V1 '))!
    const decoded = Buffer.from(marker.slice(':: OMNITERM_CONNECTION_V1 '.length), 'base64').toString('utf8')
    expect(decoded).not.toContain('must-not-persist')
    expect(decoded).not.toContain('password')
    expect(decoded).not.toContain('passwd')
    expect(decoded).not.toContain('token')
  })

  it('writes a direct mstsc launcher using public and prompt modes without a password', () => {
    const connection = ssh({
      id: 'rdp-prod-1',
      name: 'Production RDP',
      type: 'RDP',
      port: '3389',
    })
    store.save(personal, { connections: [connection], folders: [] })
    const launch = store.resolveLaunch(personal, connection.id)!
    const batch = fs.readFileSync(launch.path, 'utf8')
    expect(launch.presentation).toBe('detached')
    expect(batch).toContain('mstsc.exe /v:"server.example.com:3389" /public /prompt')
    expect(batch).not.toMatch(/password 51:b:|password\s*[:=]/i)
  })

  it('keeps a password-help URL only in encoded metadata, never in the command', () => {
    const rendered = renderBatch({
      id: 'rdp-help-1',
      name: 'RDP with vault',
      type: 'RDP',
      host: '10.0.0.9',
      port: '3389',
      user: 'admin',
      passwordHelpUrl: 'https://vault.example/rdp-help-1',
    })
    const commandLines = rendered.split(/\r?\n/).filter(line => !line.startsWith(':: '))
    expect(commandLines.join('\n')).not.toContain('vault.example')
    expect(rendered).toContain('mstsc.exe /v:"10.0.0.9:3389" /public /prompt')
  })

  it('rejects non-HTTPS password-help links', () => {
    expect(() => renderBatch({
      id: 'rdp-help-2',
      name: 'Unsafe help',
      type: 'RDP',
      host: '10.0.0.9',
      port: '3389',
      user: 'admin',
      passwordHelpUrl: 'file:///C:/secret.txt',
    })).toThrow(/HTTPS/)
  })

  it.each([
    { host: 'server&calc.exe' },
    { host: 'server|more' },
    { user: 'admin>owned.txt' },
    { port: '70000' },
    { id: '../escape' },
  ])('rejects command injection input %#', (unsafe) => {
    expect(() => renderBatch(ssh(unsafe))).toThrow(/unsafe|characters|Port/i)
  })

  it('atomically replaces renamed launchers and removes deleted launchers', () => {
    store.save(personal, { connections: [ssh()], folders: [] })
    const oldPath = store.resolveLaunch(personal, 'ssh-prod-1')!.path
    store.save(personal, { connections: [ssh({ name: 'Renamed' })], folders: [] })
    const newPath = store.resolveLaunch(personal, 'ssh-prod-1')!.path
    expect(newPath).not.toBe(oldPath)
    expect(fs.existsSync(oldPath)).toBe(false)
    expect(fs.readdirSync(path.dirname(newPath)).some((name) => name.endsWith('.tmp'))).toBe(false)

    store.save(personal, { connections: [], folders: [] })
    expect(fs.existsSync(newPath)).toBe(false)
  })

  it('stores workspace launchers only beneath .omniterm/launchers', () => {
    const workspacePath = path.join(root, 'project')
    const scope: ConnectionScope = { kind: 'workspace', workspaceId: 'ws-1', workspacePath }
    store.save(scope, { connections: [ssh()], folders: [] })
    expect(store.resolveLaunch(scope, 'ssh-prod-1')!.path)
      .toContain(path.join('project', '.omniterm', 'launchers'))
  })

  it('stores and restores the folder tree using a metadata-only BAT file', () => {
    const folders = [
      { id: 'production', name: 'Production' },
      { id: 'database', name: 'Database', parentId: 'production' },
    ]
    store.save(personal, {
      connections: [ssh({ parentId: 'database' })],
      folders,
    })
    expect(store.load(personal)).toEqual({
      connections: [ssh({ parentId: 'database' })],
      folders,
    })
    const marker = fs.readFileSync(path.join(root, 'launchers', '_omniterm-folders.bat'), 'utf8')
    expect(marker).toContain(':: OMNITERM_FOLDERS_V1 ')
    expect(marker).not.toMatch(/password\s*[:=]/i)
  })
})
