/**
 * Rejection-path cover for the launcher store.
 *
 * Every profile this plugin accepts is rendered into a `.bat` that Windows will execute, so the
 * validators are the security boundary rather than a convenience. `store.test.ts` exercises the
 * profiles that are allowed through; this file exercises the ones that must not be.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  BatchConnectionStore,
  renderBatch,
  sanitizeConnection,
  sanitizeFolder,
} from '../src/store'
import type { Connection, ConnectionScope } from '../src/types'

let dir: string
const scope: ConnectionScope = { kind: 'personal' }
const ssh = (over: Record<string, unknown> = {}) =>
  ({ id: 'a', name: 'web', type: 'SSH', host: '10.0.0.1', port: '22', user: 'root', ...over }) as Connection

beforeEach(() => {
  dir = path.join(os.tmpdir(), `omniterm-batch-valid-${crypto.randomBytes(6).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('sanitizeConnection rejections', () => {
  it.each([
    ['null', null, 'Connection must be an object.'],
    ['a string', 'connection', 'Connection must be an object.'],
    ['an array', [], 'Connection must be an object.'],
    ['a missing id', { name: 'web', type: 'SSH' }, 'Connection id and name are required.'],
    ['a missing name', { id: 'a', type: 'SSH' }, 'Connection id and name are required.'],
    ['an unsupported type', { id: 'a', name: 'web', type: 'LOCAL' }, 'Limited Connections supports SSH and RDP only.'],
  ])('rejects %s', (_label, value, message) => {
    expect(() => sanitizeConnection(value)).toThrow(message)
  })

  it('rejects an id that could escape the launcher filename', () => {
    expect(() => sanitizeConnection(ssh({ id: '../../evil' })))
      .toThrow('Connection id contains unsafe characters.')
  })

  it.each([
    ['empty', ''],
    ['non-string', 7],
    ['shell metacharacters', 'host && calc.exe'],
    ['a quote', 'host"'],
  ])('rejects a host that is %s', (_label, host) => {
    expect(() => sanitizeConnection(ssh({ host })))
      .toThrow('Host contains characters that are unsafe in a Windows launcher.')
  })

  it('rejects a username with shell metacharacters but allows an empty one', () => {
    expect(() => sanitizeConnection(ssh({ user: 'root & calc' })))
      .toThrow('Username contains characters that are unsafe in a Windows launcher.')
    expect(sanitizeConnection(ssh({ user: '' })).user).toBe('')
  })

  it.each([
    ['zero', '0'],
    ['above the 16-bit range', '65536'],
    ['not a number', 'ssh'],
    ['fractional', '22.5'],
  ])('rejects a port that is %s', (_label, port) => {
    expect(() => sanitizeConnection(ssh({ port }))).toThrow('Port must be between 1 and 65535.')
  })

  it('rejects a name carrying a control character', () => {
    expect(() => sanitizeConnection(ssh({ name: 'web\r\nshutdown' })))
      .toThrow('Connection name contains a control character.')
  })

  it.each([
    ['unparseable', 'not a url', 'Password help link must be a valid HTTPS URL.'],
    ['plain http', 'http://vault.example', 'Password help link must use HTTPS and must not contain credentials.'],
    ['carrying a username', 'https://user@vault.example', 'Password help link must use HTTPS and must not contain credentials.'],
    ['carrying a password', 'https://user:pw@vault.example', 'Password help link must use HTTPS and must not contain credentials.'],
  ])('rejects a password help link that is %s', (_label, passwordHelpUrl, message) => {
    expect(() => sanitizeConnection(ssh({ passwordHelpUrl }))).toThrow(message)
  })

  it.each([
    ['absent', undefined],
    ['a non-string', 42],
    ['whitespace only', '  '],
  ])('accepts a profile whose password help link is %s', (_label, passwordHelpUrl) => {
    expect(sanitizeConnection(ssh({ passwordHelpUrl }))).not.toHaveProperty('passwordHelpUrl')
  })

  it('defaults host, port and user that are not strings, then validates the result', () => {
    expect(() => sanitizeConnection({ id: 'a', name: 'web', type: 'SSH', host: 1, port: 22, user: 5 }))
      .toThrow('Host contains characters that are unsafe in a Windows launcher.')
  })

  it('keeps parentId and redirectDrives only when their types match', () => {
    expect(sanitizeConnection(ssh({ parentId: 'f', redirectDrives: true })))
      .toMatchObject({ parentId: 'f', redirectDrives: true })
    const loose = sanitizeConnection(ssh({ parentId: 1, redirectDrives: 'yes' }))
    expect(loose).not.toHaveProperty('parentId')
    expect(loose).not.toHaveProperty('redirectDrives')
  })
})

describe('sanitizeFolder rejections', () => {
  it.each([
    ['null', null, 'Folder must be an object.'],
    ['an array', [], 'Folder must be an object.'],
    ['a string', 'folder', 'Folder must be an object.'],
    ['a missing id', { name: 'prod' }, 'Folder id and name are required.'],
    ['a missing name', { id: 'f' }, 'Folder id and name are required.'],
  ])('rejects %s', (_label, value, message) => {
    expect(() => sanitizeFolder(value)).toThrow(message)
  })

  it('keeps parentId only when it is a string', () => {
    expect(sanitizeFolder({ id: 'f', name: 'prod', parentId: 'root' }))
      .toEqual({ id: 'f', name: 'prod', parentId: 'root' })
    expect(sanitizeFolder({ id: 'f', name: 'prod', parentId: 7 })).toEqual({ id: 'f', name: 'prod' })
  })
})

describe('folder set validation', () => {
  const save = (folders: unknown[]) =>
    new BatchConnectionStore(dir).save(scope, { folders: folders as never, connections: [] })

  it('rejects an unsafe folder id', () => {
    expect(() => save([{ id: '../f', name: 'prod' }])).toThrow('Folder id contains unsafe characters.')
  })

  it.each([
    ['blank', '   '],
    ['carrying a newline', 'prod\nrm'],
  ])('rejects a folder name that is %s', (_label, name) => {
    expect(() => save([{ id: 'f', name }])).toThrow('Folder name contains unsupported characters.')
  })

  it('rejects duplicate folder ids', () => {
    expect(() => save([{ id: 'f', name: 'a' }, { id: 'f', name: 'b' }]))
      .toThrow('Folder ids must be unique.')
  })

  it('rejects a folder whose parent is not in the same set', () => {
    expect(() => save([{ id: 'f', name: 'prod', parentId: 'ghost' }]))
      .toThrow('Folder parent does not exist.')
  })

  it('accepts a parent that is present', () => {
    save([{ id: 'root', name: 'root' }, { id: 'f', name: 'prod', parentId: 'root' }])
    expect(new BatchConnectionStore(dir).load(scope).folders).toEqual([
      { id: 'root', name: 'root' },
      { id: 'f', name: 'prod', parentId: 'root' },
    ])
  })
})

describe('renderBatch', () => {
  it('defaults the SSH port to 22 and drops the user from a bare destination', () => {
    const batch = renderBatch(ssh({ port: '', user: '' }))
    expect(batch).toContain('-p 22 -- "10.0.0.1"')
  })

  it('defaults the RDP port to 3389', () => {
    expect(renderBatch(ssh({ type: 'RDP', port: '', user: '' })))
      .toContain('mstsc.exe /v:"10.0.0.1:3389"')
  })

  it('strips characters cmd.exe would interpret from the window title', () => {
    expect(renderBatch(ssh({ name: 'we&b|<>^%!"' }))).toContain('title OmniTerm - web\r\n')
  })

  it('falls back to a generic launcher name when the profile name has no slug characters', () => {
    new BatchConnectionStore(dir).save(scope, { folders: [], connections: [ssh({ name: '!!!' })] })
    expect(fs.readdirSync(path.join(dir, 'launchers'))).toContain('connection-a.bat')
  })
})

describe('BatchConnectionStore reads', () => {
  it('reads an empty tree when the launcher directory does not exist', () => {
    expect(new BatchConnectionStore(dir).load(scope)).toEqual({ connections: [], folders: [] })
    expect(new BatchConnectionStore(dir).resolve(scope, 'a')).toBeNull()
    expect(new BatchConnectionStore(dir).resolveLaunch(scope, 'a')).toBeNull()
  })

  it('skips .bat files that carry no metadata header, and non-.bat files entirely', () => {
    const launchers = path.join(dir, 'launchers')
    fs.mkdirSync(launchers, { recursive: true })
    fs.writeFileSync(path.join(launchers, 'stray.bat'), '@echo off\r\nexit /b 0\r\n')
    fs.writeFileSync(path.join(launchers, 'notes.txt'), 'ignored')
    expect(new BatchConnectionStore(dir).load(scope).connections).toEqual([])
  })

  it('skips a .bat whose metadata is not decodable', () => {
    const launchers = path.join(dir, 'launchers')
    fs.mkdirSync(launchers, { recursive: true })
    fs.writeFileSync(path.join(launchers, 'bad.bat'), ':: OMNITERM_CONNECTION_V1 !!!notbase64!!!\r\n')
    expect(new BatchConnectionStore(dir).load(scope).connections).toEqual([])
  })

  it('reads no folders when the folder file is absent, headerless or corrupt', () => {
    const launchers = path.join(dir, 'launchers')
    const foldersFile = path.join(launchers, '_omniterm-folders.bat')
    fs.mkdirSync(launchers, { recursive: true })
    expect(new BatchConnectionStore(dir).load(scope).folders).toEqual([])

    fs.writeFileSync(foldersFile, '@echo off\r\nexit /b 0\r\n')
    expect(new BatchConnectionStore(dir).load(scope).folders).toEqual([])

    fs.writeFileSync(foldersFile, ':: OMNITERM_FOLDERS_V1 bm90anNvbg==\r\n')
    expect(new BatchConnectionStore(dir).load(scope).folders).toEqual([])
  })

  it('resolves a launch spec per protocol and removes launchers dropped from the tree', () => {
    const store = new BatchConnectionStore(dir)
    store.save(scope, { folders: [], connections: [ssh(), ssh({ id: 'b', name: 'desk', type: 'RDP' })] })
    expect(store.resolveLaunch(scope, 'a')).toMatchObject({ kind: 'batch', presentation: 'terminal' })
    expect(store.resolveLaunch(scope, 'b')).toMatchObject({ kind: 'batch', presentation: 'detached' })

    store.save(scope, { folders: [], connections: [ssh()] })
    expect(store.load(scope).connections.map((item) => item.id)).toEqual(['a'])
    expect(store.resolve(scope, 'b')).toBeNull()
  })

  it('keeps workspace launchers under the workspace directory', () => {
    const workspacePath = path.join(dir, 'ws')
    const workspace: ConnectionScope = { kind: 'workspace', workspaceId: 'ws-1', workspacePath }
    const store = new BatchConnectionStore(dir)
    store.save(workspace, { folders: [], connections: [ssh()] })
    expect(fs.existsSync(path.join(workspacePath, '.omniterm', 'launchers'))).toBe(true)
    expect(store.load(scope).connections).toEqual([])
    expect(store.resolve(workspace, 'a')).toMatchObject({ id: 'a' })
  })
})
