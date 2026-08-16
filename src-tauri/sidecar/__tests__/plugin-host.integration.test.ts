import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'

const hostEntry = path.resolve('src-tauri/sidecar/plugin-host.cjs')
const temporaryRoots: string[] = []
const children: ChildProcessWithoutNullStreams[] = []

interface RpcMessage {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
}

class HostClient {
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  readonly notifications: RpcMessage[] = []

  constructor(readonly child: ChildProcessWithoutNullStreams) {
    const lines = readline.createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      const message = JSON.parse(line) as RpcMessage
      if (message.id !== undefined && message.method) {
        this.respondToHostRequest(message)
        return
      }
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id)
        if (!waiter) return
        this.pending.delete(message.id)
        if (message.error) waiter.reject(new Error(message.error.message ?? 'RPC error'))
        else waiter.resolve(message.result)
        return
      }
      this.notifications.push(message)
    })
  }

  private respondToHostRequest(message: RpcMessage) {
    const result = message.method === 'host.openExternal'
      ? { opened: (message.params as { url: string }).url }
      : message.method === 'host.writeClipboard'
        ? true
        : null
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
  }

  call(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniterm-plugin-host-'))
  temporaryRoots.push(root)
  return root
}

function writePlugin(dir: string, options: {
  id: string
  sourceText?: string
  permissions?: string[]
  apiVersion?: number
  main?: string
}) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: options.id,
    version: '1.2.3',
    description: `${options.id} description`,
    main: options.main ?? 'index.cjs',
    omnitermPlugin: {
      apiVersion: options.apiVersion ?? 2,
      hostVersion: '>=0.1.0',
      displayName: `${options.id} display`,
      permissions: options.permissions ?? ['connections', 'auth', 'workspace', 'renderer', 'openExternal', 'clipboard'],
    },
  }))
  if (options.sourceText !== undefined) {
    fs.writeFileSync(path.join(dir, options.main ?? 'index.cjs'), options.sourceText)
  }
}

const providerPlugin = `
let tree = { folders: [], connections: [{ id: 'conn-1', name: 'Connection' }] }
module.exports = {
  activate(api) {
    api.services.log('activated')
    api.registerWorkspaceProvider({ kind: 'workspace' })
    api.registerConnectionProvider({
      load: async () => tree,
      save: async (next) => { tree = next },
      resolve: async (id) => tree.connections.find((item) => item.id === id) || null,
      capabilities: async () => ({ protocols: ['SSH'], credentialPolicy: 'prompt-every-time' }),
      loadScoped: async (scope) => ({ ...tree, scope }),
      saveScoped: async (scope, data) => { tree = { ...data, scope } },
      resolveScoped: async (scope, id) => ({ scope, item: tree.connections.find((item) => item.id === id) || null }),
      resolveLaunch: async (scope, id) => ({ kind: 'native', scope, id }),
    })
    api.registerAuthProvider({ gate: async () => false })
    api.registerInvokeHandler(async (method, ...args) => {
      if (method === 'explode') throw new Error('invoke exploded')
      if (method === 'services') {
        await api.services.openExternal('https://example.test')
        await api.services.writeClipboard('copied')
      }
      return { method, args }
    })
  },
  deactivate() { return Promise.resolve() },
}
`

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function startHost(appData: string, bundled?: string) {
  const args = [hostEntry, appData]
  if (bundled) args.push(bundled)
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(child)
  const client = new HostClient(child)
  await new Promise((resolve) => setTimeout(resolve, 30))
  return { child, client }
}

describe('plugin-host sidecar', { timeout: 60000 }, () => {
  it('rejects a missing or relative app-data directory', async () => {
    for (const args of [[], ['relative-data']]) {
      const child = spawn(process.execPath, [hostEntry, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
      const stderr: Buffer[] = []
      child.stderr.on('data', (chunk) => stderr.push(chunk))
      const code = await new Promise<number | null>((resolve) => child.on('exit', resolve))
      expect(code).toBe(2)
      expect(Buffer.concat(stderr).toString()).toContain('usage: plugin-host.cjs')
    }
  })

  it('reports an app-data path whose plugins directory cannot be created', async () => {
    const root = makeRoot()
    const file = path.join(root, 'not-a-directory')
    fs.writeFileSync(file, 'x')
    const child = spawn(process.execPath, [hostEntry, file], { stdio: ['pipe', 'pipe', 'pipe'] })
    const stderr: Buffer[] = []
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve))
    expect(code).toBe(2)
    expect(Buffer.concat(stderr).toString()).toContain('cannot create')
  })

  it('discovers providers and exercises every RPC operation', async () => {
    const appData = makeRoot()
    const bundled = path.join(makeRoot(), 'bundled-provider')
    writePlugin(bundled, { id: '@test/provider', sourceText: providerPlugin })

    const { client } = await startHost(appData, bundled)
    expect(await client.call('plugin.available')).toBe(true)

    const plugins = await client.call('plugin.list') as Array<Record<string, unknown>>
    expect(plugins).toEqual([expect.objectContaining({
      id: '@test/provider',
      source: 'bundled',
      status: 'loaded',
      activeConnectionProvider: true,
      selectedConnectionProvider: true,
      activeAuthProvider: true,
      activeInvokeHandler: true,
    })])
    expect(client.notifications).toContainEqual(expect.objectContaining({ method: 'host.log' }))

    expect(await client.call('connections.load')).toEqual({
      folders: [], connections: [{ id: 'conn-1', name: 'Connection' }],
    })
    expect(await client.call('connections.resolve', { connId: 'conn-1' })).toEqual({ id: 'conn-1', name: 'Connection' })
    expect(await client.call('connections.resolve', { connId: 'missing' })).toBeNull()
    expect(await client.call('connections.capabilities')).toEqual({
      protocols: ['SSH'], credentialPolicy: 'prompt-every-time',
    })
    expect(await client.call('connections.save', {
      data: { folders: [], connections: [{ id: 'conn-2', name: 'Saved' }] },
    })).toBe(true)
    expect(await client.call('connections.loadScoped', { scope: { kind: 'workspace', id: 'w' } }))
      .toEqual(expect.objectContaining({ scope: { kind: 'workspace', id: 'w' } }))
    expect(await client.call('connections.saveScoped', {
      scope: { kind: 'workspace', id: 'w2' },
      data: { folders: [], connections: [{ id: 'conn-3', name: 'Scoped' }] },
    })).toBe(true)
    expect(await client.call('connections.resolveScoped', {
      scope: { kind: 'workspace', id: 'w2' }, connId: 'conn-3',
    })).toEqual({ scope: { kind: 'workspace', id: 'w2' }, item: { id: 'conn-3', name: 'Scoped' } })
    expect(await client.call('connections.resolveLaunch', {
      scope: { kind: 'personal' }, connId: 'conn-3',
    })).toEqual({ kind: 'native', scope: { kind: 'personal' }, id: 'conn-3' })

    expect(await client.call('plugin.invoke', { method: 'hello', args: [1, 2] }))
      .toEqual({ method: 'hello', args: [1, 2] })
    expect(await client.call('plugin.invoke', { method: 'services', args: [] }))
      .toEqual({ method: 'services', args: [] })
    expect(await client.call('plugin.authGate')).toBe(false)
    await expect(client.call('plugin.invoke', { method: 'explode' })).rejects.toThrow('invoke exploded')

    const disabled = await client.call('plugin.setEnabled', { id: '@test/provider', enabled: false }) as Record<string, unknown>
    expect(disabled.enabled).toBe(false)
    expect(await client.call('plugin.available')).toBe(false)
    expect(await client.call('connections.load')).toBeNull()
    expect(await client.call('connections.save', { data: {} })).toBe(false)
    expect(await client.call('connections.resolve', { connId: 'x' })).toBeNull()
    expect(await client.call('connections.capabilities')).toBeNull()
    expect(await client.call('connections.loadScoped', { scope: {} })).toBeNull()
    expect(await client.call('connections.saveScoped', { scope: {}, data: {} })).toBe(false)
    expect(await client.call('connections.resolveScoped', { scope: {}, connId: 'x' })).toBeNull()
    expect(await client.call('connections.resolveLaunch', { scope: {}, connId: 'x' })).toBeNull()
    expect(await client.call('plugin.authGate')).toBe(true)
    await expect(client.call('plugin.invoke', { method: 'none' })).rejects.toThrow('No active plugin')
    await expect(client.call('plugin.setEnabled', { id: 'missing', enabled: true })).rejects.toThrow('not found')
    await expect(client.call('plugin.selectConnectionProvider', { id: 'missing' })).rejects.toThrow('not available')

    expect(await client.call('plugin.uninstall', { id: '@test/provider' })).toBe(true)
    expect(await client.call('plugin.list')).toEqual([])
    await expect(client.call('unknown.method')).rejects.toThrow('Unknown RPC method')
  })

  it('discovers plugin directories and preserves incompatible/error descriptors', async () => {
    const appData = makeRoot()
    const userPlugins = path.join(appData, 'plugins')
    const bundledRoot = makeRoot()
    writePlugin(path.join(bundledRoot, 'good'), { id: '@test/good', sourceText: providerPlugin })
    writePlugin(path.join(bundledRoot, 'incompatible'), {
      id: '@test/incompatible', sourceText: 'throw new Error("must not execute")', apiVersion: 1,
    })
    writePlugin(path.join(userPlugins, 'missing-main'), { id: '@test/missing-main' })
    fs.writeFileSync(path.join(userPlugins, 'not-a-directory'), 'ignored')
    fs.mkdirSync(path.join(userPlugins, 'not-a-plugin'), { recursive: true })
    fs.writeFileSync(path.join(userPlugins, 'not-a-plugin', 'package.json'), JSON.stringify({ name: 'plain-package' }))

    const { client } = await startHost(appData, bundledRoot)
    const plugins = await client.call('plugin.list') as Array<Record<string, unknown>>
    expect(plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '@test/good', source: 'bundled', status: 'loaded' }),
      expect.objectContaining({ id: '@test/incompatible', status: 'incompatible' }),
      expect.objectContaining({ id: '@test/missing-main', source: 'user', status: 'error' }),
    ]))
  })

  it('routes plugin.invoke to whichever handler owns the method across multiple plugins', async () => {
    const appData = makeRoot()
    const bundled = path.join(makeRoot(), 'bundled-renderer-plugins')
    writePlugin(path.join(bundled, 'alpha'), {
      id: '@test/alpha',
      permissions: ['renderer'],
      sourceText: `
module.exports = {
  activate(api) {
    api.registerInvokeHandler((method) => {
      if (method === 'alpha.info') return { plugin: 'alpha' }
      throw new Error('Unknown Alpha method "' + method + '"')
    })
  },
}
`,
    })
    writePlugin(path.join(bundled, 'beta'), {
      id: '@test/beta',
      permissions: ['renderer'],
      sourceText: `
module.exports = {
  activate(api) {
    api.registerInvokeHandler((method) => {
      if (method === 'beta.info') return { plugin: 'beta' }
      throw new Error('Unknown Beta method "' + method + '"')
    })
  },
}
`,
    })

    const { client } = await startHost(appData, bundled)
    // Both handlers reject methods they do not own; the sidecar must skip to the owner instead of
    // letting the first-loaded plugin shadow the second (the missing Blur icon bug).
    expect(await client.call('plugin.invoke', { method: 'alpha.info', args: [] })).toEqual({ plugin: 'alpha' })
    expect(await client.call('plugin.invoke', { method: 'beta.info', args: [] })).toEqual({ plugin: 'beta' })
    await expect(client.call('plugin.invoke', { method: 'gamma.info', args: [] })).rejects.toThrow()
  })

  it('restores the persisted provider preference and can clear selection', async () => {
    const appData = makeRoot()
    const plugins = path.join(appData, 'plugins')
    writePlugin(path.join(plugins, 'first'), { id: '@test/first', sourceText: providerPlugin })
    writePlugin(path.join(plugins, 'second'), { id: '@test/second', sourceText: providerPlugin })
    fs.writeFileSync(path.join(appData, 'active-connection-provider.json'), JSON.stringify({ id: '@test/second' }))

    const { client } = await startHost(appData)
    let listed = await client.call('plugin.list') as Array<Record<string, unknown>>
    expect(listed.find((item) => item.id === '@test/second')?.selectedConnectionProvider).toBe(true)

    listed = await client.call('plugin.selectConnectionProvider', { id: '@test/first' }) as Array<Record<string, unknown>>
    expect(listed.find((item) => item.id === '@test/first')?.selectedConnectionProvider).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(appData, 'active-connection-provider.json'), 'utf8')))
      .toEqual({ id: '@test/first' })

    listed = await client.call('plugin.selectConnectionProvider', { id: null }) as Array<Record<string, unknown>>
    expect(listed.every((item) => item.selectedConnectionProvider === false)).toBe(true)
  })
})
