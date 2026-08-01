import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { activate, deactivate, name } from '../src/index'
import type { ConnectionProvider, ConnectionTree, HostAPI } from '../src/types'

let root: string
let provider: ConnectionProvider
let openExternal: ReturnType<typeof vi.fn>
let log: ReturnType<typeof vi.fn>

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniterm-full-provider-'))
  openExternal = vi.fn(async () => undefined)
  log = vi.fn()
  const host: HostAPI = {
    plugin: { id: name, version: '1.0.0', permissions: ['connections', 'openExternal'] },
    services: { storageDir: path.join(root, 'personal'), log, openExternal, writeClipboard: async () => undefined },
    registerConnectionProvider: (registered) => { provider = registered },
    registerAuthProvider: () => undefined,
    registerInvokeHandler: () => undefined,
  }
  await activate(host)
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const tree = (passwordHelpUrl?: string): ConnectionTree => ({
  folders: [{ id: 'ops', name: 'Operations' }],
  connections: [{
    id: 'ssh-1',
    name: 'Production',
    type: 'SSH',
    host: 'server.example.com',
    port: '22',
    user: 'operator',
    parentId: 'ops',
    passwordHelpUrl,
  }],
})

describe('full connection manager activation', () => {
  it('registers metadata-only capabilities and logs activation', () => {
    expect(name).toBe('@omniterm/full-connection-manager')
    expect(provider.capabilities?.()).toEqual({
      protocols: ['SSH', 'RDP'],
      credentialPolicy: 'prompt-every-time',
      scopes: ['personal', 'workspace'],
      sftp: false,
      importExport: true,
    })
    expect(log).toHaveBeenCalledWith('full-connection-manager activated')
    expect(deactivate()).toBeUndefined()
  })

  it('persists and resolves personal connections', async () => {
    await provider.save(tree())
    expect(await provider.load()).toEqual(tree())
    expect(await provider.resolve('ssh-1')).toEqual(tree().connections[0])
    expect(await provider.resolve('missing')).toBeNull()
  })

  it('isolates each workspace store and reuses the same scoped store', async () => {
    const first = { kind: 'workspace' as const, workspaceId: 'a', workspacePath: path.join(root, 'a') }
    const second = { kind: 'workspace' as const, workspaceId: 'b', workspacePath: path.join(root, 'b') }
    fs.mkdirSync(first.workspacePath, { recursive: true })
    fs.mkdirSync(second.workspacePath, { recursive: true })

    await provider.saveScoped?.(first, tree())
    expect(await provider.loadScoped?.(first)).toEqual(tree())
    expect(await provider.resolveScoped?.(first, 'ssh-1')).toEqual(tree().connections[0])
    expect(await provider.loadScoped?.(second)).toEqual({ folders: [], connections: [] })
  })

  it('opens optional password help and treats an opener failure as non-fatal', async () => {
    const withHelp = tree('https://vault.example/ssh-1')
    await provider.save(withHelp)
    expect(await provider.resolve('ssh-1')).toEqual(withHelp.connections[0])
    expect(openExternal).toHaveBeenCalledWith('https://vault.example/ssh-1')

    openExternal.mockRejectedValueOnce(new Error('browser unavailable'))
    expect(await provider.resolve('ssh-1')).toEqual(withHelp.connections[0])
  })
})
