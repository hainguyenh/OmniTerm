/**
 * @vitest-environment jsdom
 *
 * Contract tests for the Tauri ↔ omnitermAPI bridge.
 *
 * Every bug this suite pins was a silent one: a command name or argument key that does not match the
 * Rust `#[tauri::command]` signature fails at runtime with "invalid args" or "command not found", and
 * several of those calls swallow their own rejections. Asserting the exact `invoke` payload is the
 * only way to catch that without launching the app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const invokeMock = vi.fn()
const listenMock = vi.fn()
const emitMock = vi.fn()
const openMock = vi.fn()
const writeTextMock = vi.fn()
const readTextMock = vi.fn()
const homeDirMock = vi.fn()

/** Stands in for `@tauri-apps/api/core`'s Channel: the backend end is just its `onmessage`. */
class FakeChannel {
  onmessage: ((message: unknown) => void) | undefined
  toJSON() {
    return '__CHANNEL__:1'
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: FakeChannel,
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
  emit: (...args: unknown[]) => emitMock(...args),
}))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: (...args: unknown[]) => writeTextMock(...args),
  readText: (...args: unknown[]) => readTextMock(...args),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => openMock(...args) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: '' }) }))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: (...args: unknown[]) => homeDirMock(...args) }))

const { __createTauriAPIForTests, initTauriBridge } = await import('../omnitermAPI')
const { __resetSessionsForTests } = await import('../tauriSessions')

/** The last `invoke` call as `[command, args]`. */
function lastInvoke(): [string, Record<string, unknown>] {
  const call = invokeMock.mock.calls.at(-1)
  if (!call) throw new Error('invoke was never called')
  return [call[0] as string, (call[1] ?? {}) as Record<string, unknown>]
}

function invokedCommands(): string[] {
  return invokeMock.mock.calls.map((c) => c[0] as string)
}

/** The channels the bridge handed to `start_local_session`, i.e. the backend's end of the stream. */
function sessionChannels(): { data: FakeChannel; status: FakeChannel } {
  const call = invokeMock.mock.calls.find((c) => c[0] === 'start_local_session')
  if (!call) throw new Error('start_local_session was never invoked')
  const args = call[1] as { onData: FakeChannel; onStatus: FakeChannel }
  return { data: args.onData, status: args.onStatus }
}

/** `start_local_session` args with the two channels dropped, so a case can assert the rest exactly. */
function startArgs(): Record<string, unknown> {
  const [, args] = lastInvoke()
  const { onData: _d, onStatus: _s, ...rest } = args as Record<string, unknown>
  return rest
}

let api: any

beforeEach(() => {
  vi.clearAllMocks()
  // Session handlers live in a module-wide map; a case that leaves one subscribed must not deliver
  // into the next one.
  __resetSessionsForTests()
  invokeMock.mockResolvedValue(undefined)
  emitMock.mockResolvedValue(undefined)
  listenMock.mockResolvedValue(() => {})
  api = __createTauriAPIForTests()
})

// ── Surface completeness ─────────────────────────────────────────────

describe('bridge surface', () => {
  it('exposes every namespace the renderer reaches for', () => {
    for (const ns of [
      'connections', 'plugin', 'connect', 'terminalWindow', 'clipboard', 'sftp',
      'app', 'files', 'settings', 'workspace', 'updates', 'themes', 'windowControl', 'shells',
    ]) {
      expect(api[ns], `missing namespace ${ns}`).toBeDefined()
    }
  })

  it('only installs itself when running under Tauri', () => {
    delete (window as any).omnitermAPI
    delete (window as any).__TAURI_INTERNALS__
    initTauriBridge()
    expect((window as any).omnitermAPI).toBeUndefined()

    ;(window as any).__TAURI_INTERNALS__ = {}
    initTauriBridge()
    expect((window as any).omnitermAPI).toBeDefined()
    delete (window as any).__TAURI_INTERNALS__
    delete (window as any).omnitermAPI
  })

  it('maps the OS name onto the process.platform value the renderer branches on', () => {
    expect(api.app.platform).toBe('win32')
  })
})

// ── Local sessions ───────────────────────────────────────────────────

describe('connect.local', () => {
  it('passes the connection id and a channel pair to the backend', async () => {
    await api.connect.local('sess-1', 'conn-1', 'cmd')
    const [command, args] = lastInvoke()
    expect(command).toBe('start_local_session')
    expect(startArgs()).toEqual({ id: 'sess-1', connId: 'conn-1', shell: 'cmd' })
    expect(args.onData).toBeInstanceOf(FakeChannel)
    expect(args.onStatus).toBeInstanceOf(FakeChannel)
  })

  it('forwards the app appearance mode to local PTY startup', async () => {
    await api.connect.local('sess-1', 'conn-1', 'cmd', false)
    expect(startArgs()).toEqual({ id: 'sess-1', connId: 'conn-1', shell: 'cmd', darkMode: false })
  })

  /**
   * Resolution belongs in the backend: an `adhoc-…` id exists only in the backend's in-memory
   * registry, so a webview-side lookup against connections.json finds nothing and the pane opens as a
   * bare default shell in the wrong directory.
   */
  it('does not read the connection tree itself', async () => {
    await api.connect.local('sess-1', 'adhoc-abc')
    expect(invokedCommands()).not.toContain('load_connections')
    expect(invokedCommands()).toEqual(['start_local_session'])
  })

  it('sends a null override rather than omitting it when no shell is given', async () => {
    await api.connect.local('sess-1', 'conn-1')
    expect(startArgs()).toEqual({ id: 'sess-1', connId: 'conn-1', shell: null })
  })

  /**
   * Session traffic must not travel on named events. A session id may contain characters Tauri
   * rejects in an event name (`[A-Za-z0-9-/:_]` only), which failed every subscription and left the
   * pane on "connecting"; a global event is also readable and forgeable by any script in the webview.
   */
  it('keeps session traffic off the global event bus', async () => {
    api.connect.onLocalReady('s1', () => {})
    api.connect.onLocalData('s1', () => {})
    api.connect.onLocalError('s1', () => {})
    api.connect.onLocalClosed('s1', () => {})
    await api.connect.local('s1', 'c1')

    const names = [...listenMock.mock.calls, ...emitMock.mock.calls].map((c) => String(c[0]))
    expect(names.filter((n) => n.startsWith('session-'))).toEqual([])
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('reports a failed start on the session error handler', async () => {
    invokeMock.mockRejectedValueOnce('Unsupported shell "calc.exe".')
    const errors: string[] = []
    api.connect.onLocalError('sess-1', (e: string) => errors.push(e))
    await api.connect.local('sess-1', 'conn-1')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Unsupported shell')
  })

  it('forwards input, resize and disconnect with the expected argument names', async () => {
    await api.connect.localInput('s1', 'ls\r')
    expect(lastInvoke()).toEqual(['send_session_input', { id: 's1', data: 'ls\r' }])

    await api.connect.localResize('s1', { cols: 120, rows: 40 })
    expect(lastInvoke()).toEqual(['resize_session', { id: 's1', cols: 120, rows: 40 }])

    await api.connect.localDisconnect('s1')
    expect(lastInvoke()).toEqual(['disconnect_session', { id: 's1' }])
  })
})

/**
 * The hang this pins: the first port streamed over `listen()`, which registers its handler through an
 * async IPC round-trip, so a listener is NOT live when the call returns. TerminalView subscribes and
 * then calls `connect()` in the same tick, and the backend starts streaming the moment the PTY
 * spawns — so the first output landed before the listeners existed and was dropped. For a LOCAL pane
 * the UI only leaves "connecting" on the first data event, so losing it meant connecting forever with
 * no output and no error. Channel callbacks are attached synchronously, before `invoke`, which is what
 * these cases hold in place.
 */
describe('session streaming', () => {
  it('can already deliver output at the moment the backend starts streaming', async () => {
    const received: Uint8Array[] = []
    let readyLabel: string | undefined = 'not called'
    api.connect.onLocalData('s1', (d: Uint8Array) => received.push(d))
    api.connect.onLocalReady('s1', (label?: string) => { readyLabel = label })

    // Stream from inside `invoke`, i.e. as early as the backend possibly can.
    invokeMock.mockImplementationOnce((_cmd: string, args: any) => {
      args.onStatus.onmessage({ kind: 'ready', label: 'PowerShell' })
      args.onData.onmessage(new Uint8Array([104, 105]).buffer)
      return Promise.resolve()
    })
    await api.connect.local('s1', 'c1')

    expect(readyLabel).toBe('PowerShell')
    expect(received.map((b) => Array.from(b))).toEqual([[104, 105]])
  })

  it('decodes raw channel payloads into a Uint8Array', async () => {
    const received: Uint8Array[] = []
    api.connect.onLocalData('s1', (d: Uint8Array) => received.push(d))
    await api.connect.local('s1', 'c1')

    sessionChannels().data.onmessage?.(new Uint8Array([1, 2, 3]).buffer)
    // Tauri sends raw bodies as an ArrayBuffer, but a JSON fallback must not corrupt the stream.
    sessionChannels().data.onmessage?.([4, 5])

    expect(received.every((b) => b instanceof Uint8Array)).toBe(true)
    expect(received.map((b) => Array.from(b))).toEqual([[1, 2, 3], [4, 5]])
  })

  it('maps each status message onto its own callback', async () => {
    const seen: string[] = []
    api.connect.onLocalReady('s1', (label?: string) => seen.push(`ready:${label}`))
    api.connect.onLocalError('s1', (e: string) => seen.push(`error:${e}`))
    api.connect.onLocalClosed('s1', (code: number) => seen.push(`closed:${code}`))
    await api.connect.local('s1', 'c1')

    const { status } = sessionChannels()
    status.onmessage?.({ kind: 'ready', label: 'WSL' })
    status.onmessage?.({ kind: 'error', message: 'read failed' })
    status.onmessage?.({ kind: 'closed', code: 130 })
    expect(seen).toEqual(['ready:WSL', 'error:read failed', 'closed:130'])
  })

  it('keeps two panes of the same connection independent', async () => {
    const first: number[][] = []
    const second: number[][] = []
    api.connect.onLocalData('s1', (d: Uint8Array) => first.push(Array.from(d)))
    await api.connect.local('s1', 'c1')
    const firstChannels = sessionChannels()

    invokeMock.mockClear()
    api.connect.onLocalData('s2', (d: Uint8Array) => second.push(Array.from(d)))
    await api.connect.local('s2', 'c1')

    firstChannels.data.onmessage?.(new Uint8Array([1]).buffer)
    sessionChannels().data.onmessage?.(new Uint8Array([2]).buffer)
    expect(first).toEqual([[1]])
    expect(second).toEqual([[2]])
  })

  it('stops delivering to a handler that unsubscribed', async () => {
    const received: number[][] = []
    const off = api.connect.onLocalData('s1', (d: Uint8Array) => received.push(Array.from(d)))
    await api.connect.local('s1', 'c1')

    sessionChannels().data.onmessage?.(new Uint8Array([1]).buffer)
    off()
    sessionChannels().data.onmessage?.(new Uint8Array([2]).buffer)
    expect(received).toEqual([[1]])
  })

  /** StrictMode double-mounts: the old effect's cleanup runs after the new one has subscribed. */
  it('a stale unsubscribe does not detach the handler that replaced it', async () => {
    const received: string[] = []
    const offOld = api.connect.onLocalData('s1', () => received.push('old'))
    api.connect.onLocalData('s1', () => received.push('new'))
    offOld()
    await api.connect.local('s1', 'c1')

    sessionChannels().data.onmessage?.(new Uint8Array([1]).buffer)
    expect(received).toEqual(['new'])
  })
})

describe('SSH', () => {
  it('prepares the provider connection before opening a ConPTY session', async () => {
    invokeMock.mockResolvedValueOnce(undefined)
    await api.connect.ssh('s1')
    expect(invokeMock).toHaveBeenCalledWith('prepare_ssh_session', { connId: 's1' })
  })
})

describe('RDP', () => {
  it('launches through connect_rdp with the connection id', async () => {
    invokeMock.mockResolvedValueOnce({ ok: true })
    await expect(api.connect.rdp('c1')).resolves.toMatchObject({ ok: true })
    expect(invokeMock).toHaveBeenCalledWith('connect_rdp', { id: 'c1' })
  })

  /** A refused launch has to surface as `{ ok: false }` — the renderer branches on it. */
  it('reports a refused launch rather than rejecting', async () => {
    invokeMock.mockRejectedValueOnce(new Error('Remote Desktop is not available.'))
    await expect(api.connect.rdp('c1')).resolves.toMatchObject({
      ok: false,
      error: 'Remote Desktop is not available.',
    })
  })

  it('disconnects through rdp_disconnect', () => {
    invokeMock.mockResolvedValueOnce(undefined)
    api.connect.rdpDisconnect('c1')
    expect(invokeMock).toHaveBeenCalledWith('rdp_disconnect', { id: 'c1' })
  })

  /**
   * The client is a separate top-level window, not embedded in a pane. These stay no-ops because the
   * backend commands they used to call had empty bodies — the renderer believed it was positioning
   * something. Pinned so nobody re-adds a host command to make them "work".
   */
  it('does not call the backend to position a window it does not embed', () => {
    invokeMock.mockClear()
    api.connect.rdpSetBounds('c1', { x: 0, y: 0, width: 10, height: 10, dpr: 1 })
    api.connect.rdpSetVisible('c1', true)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('subscribes to the lifecycle events the backend emits', () => {
    listenMock.mockClear()
    api.connect.onRDPReady('c1', () => {})
    api.connect.onRDPError('c1', () => {})
    api.connect.onRDPClosed('c1', () => {})
    const events = listenMock.mock.calls.map((c) => c[0])
    expect(events).toEqual(['rdp-ready-c1', 'rdp-error-c1', 'rdp-closed-c1'])
  })
})

// ── Event subscriptions ──────────────────────────────────────────────

describe('event subscriptions', () => {
  it('unsubscribes even when cancelled before listen resolves', async () => {
    const unlisten = vi.fn()
    let resolveListen: (fn: () => void) => void = () => {}
    listenMock.mockReturnValue(new Promise((res) => { resolveListen = res as any }))

    const off = api.windowControl.onMaximizedState(() => {})
    off() // cancel first
    resolveListen(unlisten)
    await Promise.resolve()
    await Promise.resolve()

    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes once when cancelled after listen resolves', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValue(unlisten)
    const off = api.shells.onOpen(() => {})
    await Promise.resolve()
    off()
    off()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('listens on the event names the backend emits', () => {
    api.shells.onOpen(() => {})
    expect(listenMock).toHaveBeenCalledWith('shell-open', expect.any(Function))
    api.windowControl.onMaximizedState(() => {})
    expect(listenMock).toHaveBeenCalledWith('maximized-state', expect.any(Function))
  })
})
