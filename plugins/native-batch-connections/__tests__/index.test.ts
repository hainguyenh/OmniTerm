import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { activate, deactivate, name } from '../src/index'
import type { ConnectionProvider, ConnectionScope, ConnectionTree, HostAPI } from '../src/types'

let root: string
let provider: ConnectionProvider
let openExternal: ReturnType<typeof vi.fn>
let log: ReturnType<typeof vi.fn>

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniterm-limited-provider-'))
  openExternal = vi.fn(async () => undefined)
  log = vi.fn()
  const host: HostAPI = {
    plugin: { id: name, version: '1.0.0', permissions: ['connections', 'openExternal'] },
    services: { storageDir: root, log, openExternal },
    registerConnectionProvider: (registered) => { provider = registered },
  }
  activate(host)
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const connection = (passwordHelpUrl?: string) => ({
  id: 'ssh-1',
  name: 'Production',
  type: 'SSH' as const,
  host: 'server.example.com',
  port: '22',
  user: 'operator',
  passwordHelpUrl,
})
const tree = (passwordHelpUrl?: string): ConnectionTree => ({
  folders: [],
  connections: [connection(passwordHelpUrl)],
})

describe('limited connection provider activation', () => {
  it('registers native-launch capabilities and logs activation', () => {
    expect(name).toBe('@omniterm/native-batch-connections')
    expect(provider.capabilities()).toEqual({
      protocols: ['SSH', 'RDP'],
      credentialPolicy: 'prompt-every-time',
      scopes: ['personal', 'workspace'],
      sftp: false,
      importExport: true,
    })
    expect(log).toHaveBeenCalledWith('Limited Connections activated')
    expect(deactivate()).toBeUndefined()
  })

  it('supports personal load, save, and resolve through the compatibility methods', async () => {
    await provider.save(tree())
    expect(await provider.load()).toEqual(tree())
    expect(await provider.resolve('ssh-1')).toEqual(connection())
    expect(await provider.resolve('missing')).toBeNull()
  })

  it('supports workspace-scoped persistence and native launch resolution', async () => {
    const scope: ConnectionScope = {
      kind: 'workspace',
      workspaceId: 'workspace-1',
      workspacePath: path.join(root, 'project'),
    }
    await provider.saveScoped?.(scope, tree())

    expect(await provider.loadScoped?.(scope)).toEqual(tree())
    expect(await provider.resolveScoped?.(scope, 'ssh-1')).toEqual(connection())
    const launch = await provider.resolveLaunch?.(scope, 'ssh-1')
    expect(launch?.kind).toBe('batch')
    expect(launch?.path).toContain(path.join('.omniterm', 'launchers'))
  })

  it('opens password help before returning the launch specification', async () => {
    const personal: ConnectionScope = { kind: 'personal' }
    await provider.save(tree('https://vault.example/ssh-1'))
    const launch = await provider.resolveLaunch?.(personal, 'ssh-1')

    expect(openExternal).toHaveBeenCalledWith('https://vault.example/ssh-1')
    expect(launch?.kind).toBe('batch')
  })
})
