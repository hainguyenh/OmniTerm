/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tauri: true,
  list: vi.fn(),
  restart: vi.fn(),
  call: vi.fn(async (value: unknown) => value),
  handlers: new Map<string, (event: Record<string, unknown>) => void>(),
  disposers: [] as Array<ReturnType<typeof vi.fn>>,
  lspServersIsFn: true,
  lspRestartIsFn: true,
}))

vi.mock('../../../ide/bindings', () => ({
  commands: {
    get lspServers() { return h.lspServersIsFn ? h.list : undefined },
    get lspRestart() { return h.lspRestartIsFn ? h.restart : undefined },
  },
}))
vi.mock('../../../ide/platform/ipc', () => ({
  isTauri: () => h.tauri,
  call: (value: unknown) => h.call(value),
  onIdeEvent: (name: string, handler: (event: Record<string, unknown>) => void) => {
    h.handlers.set(name, handler)
    const dispose = vi.fn()
    h.disposers.push(dispose)
    return dispose
  },
}))

import { initLspServersEvents, normalizeStatus, useLspServersStore } from '../lspServersStore'

const store = () => useLspServersStore.getState()
const record = (over: Record<string, unknown> = {}) => ({
  id: 1, name: 'rust-analyzer', languages: ['rust'], status: 'Ready' as const, rawStatus: 'ready', message: null, installHint: null, ...over,
})

describe('normalizeStatus', () => {
  it.each([
    ['READY', 'Ready'], ['starting', 'Starting'], ['busy', 'Starting'], ['stopping', 'Stopping'], ['stopped', 'Stopping'],
    ['missing', 'Missing'], ['crashed', 'Failed'], ['failed', 'Failed'], ['misconfigured', 'Failed'], ['whatever', 'Idle'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeStatus(raw)).toBe(expected)
  })
})

describe('useLspServersStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.tauri = true
    h.lspServersIsFn = true
    h.lspRestartIsFn = true
    h.list.mockReturnValue([])
    h.restart.mockReturnValue(Promise.resolve())
    store().reset()
  })

  it('derives the overall status with failure before missing before starting before ready', () => {
    expect(store().overallStatus).toBe('Idle')
    store().setServer(record({ id: 1, status: 'Idle' }))
    expect(store().overallStatus).toBe('Idle')
    store().setServer(record({ id: 2, status: 'Ready' }))
    expect(store().overallStatus).toBe('Ready')
    store().setServer(record({ id: 3, status: 'Starting' }))
    expect(store().overallStatus).toBe('Starting')
    store().setServer(record({ id: 4, status: 'Missing' }))
    expect(store().overallStatus).toBe('Missing')
    store().setServer(record({ id: 5, status: 'Failed' }))
    expect(store().overallStatus).toBe('Failed')
    store().removeServer(5)
    store().removeServer(4)
    expect(store().overallStatus).toBe('Starting')
  })

  it('updates a known server by id and keeps what the update does not carry', () => {
    store().setServer(record({ pid: 7, message: 'old', languages: ['rust'] }))
    store().updateServerStatus(1, 'starting')
    const updated = store().servers.get(1)!
    expect(updated).toMatchObject({ status: 'Starting', rawStatus: 'starting', message: 'old', pid: 7, languages: ['rust'] })
  })

  it('finds a server by name, ignoring case', () => {
    store().setServer(record())
    store().updateServerStatus('RUST-Analyzer', 'failed', 'boom')
    expect(store().servers.size).toBe(1)
    expect(store().servers.get(1)).toMatchObject({ status: 'Failed', message: 'boom' })
  })

  it('creates a record for an unknown numeric or named server', () => {
    store().updateServerStatus(42, 'ready')
    expect(store().servers.get(42)?.name).toBe('Server 42')
    store().updateServerStatus('gopls', 'missing')
    const created = [...store().servers.values()].find((s) => s.name === 'gopls')!
    expect(created).toMatchObject({ status: 'Missing', installHint: 'go install golang.org/x/tools/gopls@latest' })
  })

  it('prefers a hint given with the update, then one in the message, then the defaults', () => {
    store().updateServerStatus(1, 'missing', 'please install foo', 'explicit hint')
    expect(store().servers.get(1)?.installHint).toBe('explicit hint')
    store().updateServerStatus(2, 'missing', 'Install it with npm')
    expect(store().servers.get(2)?.installHint).toBe('Install it with npm')
    store().updateServerStatus('Pyright', 'missing')
    expect([...store().servers.values()].find((s) => s.name === 'Pyright')?.installHint).toBe('npm install -g pyright')
    store().updateServerStatus(3, 'failed', 'plain message')
    expect(store().servers.get(3)?.installHint).toBe('plain message')
    store().updateServerStatus(4, 'idle')
    expect(store().servers.get(4)?.installHint).toBeNull()
  })

  it('accepts an already normalized status', () => {
    store().updateServerStatus(9, 'Ready' as never)
    expect(store().servers.get(9)?.status).toBe('Ready')
  })

  it('loads the server list from the backend', async () => {
    h.list.mockReturnValue([
      { id: 1, name: 'clangd', languages: ['c'], status: 'ready', pid: 11 },
      { id: 2, name: 'custom', languages: [], status: 'crashed', pid: null },
    ])
    await store().refreshServers()
    expect(store().servers.size).toBe(2)
    expect(store().servers.get(1)).toMatchObject({ status: 'Ready', pid: 11, installHint: 'Install LLVM / Clang from your package manager' })
    expect(store().servers.get(2)).toMatchObject({ status: 'Failed', installHint: null })
    expect(store().overallStatus).toBe('Failed')
  })

  it('leaves the list alone outside Tauri, without the command, or on a bad answer', async () => {
    store().setServer(record())
    h.tauri = false
    await store().refreshServers()
    h.tauri = true
    h.lspServersIsFn = false
    await store().refreshServers()
    h.lspServersIsFn = true
    h.list.mockReturnValue('nope')
    await store().refreshServers()
    h.call.mockRejectedValueOnce(new Error('ipc'))
    await store().refreshServers()
    expect(store().servers.size).toBe(1)
  })

  it('restarts one server and refreshes', async () => {
    store().setServer(record())
    await store().restartServer(1)
    expect(h.restart).toHaveBeenCalledWith(1)
    expect(store().isRestarting).toBe(false)
    expect(h.list).toHaveBeenCalled()
  })

  it('restarts every server when no id is given', async () => {
    store().setServer(record({ id: 1 }))
    store().setServer(record({ id: 2, name: 'gopls' }))
    await store().restartServer()
    expect(h.restart.mock.calls.map((call) => call[0])).toEqual([1, 2])
  })

  it('survives a failing restart call and works without the command or Tauri', async () => {
    store().setServer(record())
    h.call.mockRejectedValueOnce(new Error('restart failed'))
    await store().restartServer(1)
    expect(store().isRestarting).toBe(false)
    h.lspRestartIsFn = false
    await store().restartServer(1)
    await store().restartServer()
    h.tauri = false
    await store().restartServer(1)
    expect(store().servers.get(1)?.status).toBe('Starting')
  })

  it('follows language server events and unsubscribes once', () => {
    const stop = initLspServersEvents()
    expect(initLspServersEvents()).toBe(stop)
    h.handlers.get('languageServer')?.({ server: 5, status: 'ready', message: null })
    h.handlers.get('languageServerWarning')?.({ name: 'gopls', message: 'not found', installTool: 'go get gopls' })
    expect(store().servers.get(5)?.status).toBe('Ready')
    expect([...store().servers.values()].find((s) => s.name === 'gopls')).toMatchObject({ status: 'Missing', installHint: 'go get gopls' })
    h.handlers.get('languageServerRemoved')?.({ server: 5 })
    expect(store().servers.has(5)).toBe(false)
    const disposers = [...h.disposers]
    stop()
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1)
    const again = initLspServersEvents()
    expect(again).not.toBe(stop)
    again()
  })
})
