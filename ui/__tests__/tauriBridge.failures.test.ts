/** @vitest-environment jsdom */
/**
 * The bridge's failure arms.
 *
 * `tauriBridge.coverage.test.ts` drives every command down its success path. Almost all of them are
 * fire-and-forget — `void invoke(...).catch(...)` — so a rejected command is the only thing that
 * runs the handler, and a renderer that throws from one of these would take the window down. This
 * file rejects each one and asserts the failure stays contained.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diag } from '../diag'

const state = vi.hoisted(() => ({
  platform: 'linux' as string,
  label: '' as string,
  labelThrows: false,
  invoke: vi.fn(),
  listen: vi.fn(),
  open: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  writeText: vi.fn(),
  readText: vi.fn(),
  homeDir: vi.fn(),
  startSession: vi.fn(),
  attachSession: vi.fn(),
  failSession: vi.fn(),
  // Records every subscription so a test can fire the backend event by hand.
  sessionHandlers: [] as Array<{ id: string; kind: string; cb: (value: unknown) => void }>,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => state.invoke(...args),
  convertFileSrc: (path: string) => state.convertFileSrc(path),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => state.listen(...args),
}))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => state.platform }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: (...args: unknown[]) => state.writeText(...args),
  readText: (...args: unknown[]) => state.readText(...args),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => state.open(...args) }))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: (...args: unknown[]) => state.homeDir(...args) }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => {
    if (state.labelThrows) throw new Error('no window context')
    return { label: state.label }
  },
}))
vi.mock('../tauriSessions', () => ({
  startSession: (...args: unknown[]) => state.startSession(...args),
  attachSession: (...args: unknown[]) => state.attachSession(...args),
  failSession: (...args: unknown[]) => state.failSession(...args),
  onSession: (id: string, kind: string, cb: (value: unknown) => void) => {
    state.sessionHandlers.push({ id, kind, cb })
    return () => {}
  },
}))

const { __createTauriAPIForTests, initTauriBridge } = await import('../omnitermAPI')

beforeEach(() => {
  vi.clearAllMocks()
  state.platform = 'linux'
  state.label = ''
  state.labelThrows = false
  state.sessionHandlers = []
  state.invoke.mockResolvedValue(undefined)
  state.listen.mockResolvedValue(vi.fn())
})

afterEach(() => vi.restoreAllMocks())

describe('window identity', () => {
  it('reports no detached session when the window label cannot be read', () => {
    const warn = vi.spyOn(diag, 'warn').mockImplementation(() => {})
    state.labelThrows = true
    expect(__createTauriAPIForTests().terminalWindow.detachedSessionId).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      '[omnitermAPI] could not read the window label',
      expect.any(Error),
    )
  })
})

describe('fire-and-forget commands swallow a rejected backend', () => {
  it.each([
    ['localInput', (api: any) => api.connect.localInput('s1', 'ls\r')],
    ['localResize', (api: any) => api.connect.localResize('s1', { cols: 80, rows: 24 })],
    ['localDisconnect', (api: any) => api.connect.localDisconnect('s1')],
    ['sshInput', (api: any) => api.connect.sshInput('s1', 'ls\r')],
    ['sshResize', (api: any) => api.connect.sshResize('s1', { cols: 80, rows: 24 })],
    ['sshDisconnect', (api: any) => api.connect.sshDisconnect('s1')],
    ['shells.release', (api: any) => api.shells.release('c1')],
  ])('%s', async (_label, call) => {
    state.invoke.mockRejectedValue(new Error('backend gone'))
    const api = __createTauriAPIForTests()
    expect(() => call(api)).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('reports an rdpDisconnect failure through diag rather than rejecting', async () => {
    const error = vi.spyOn(diag, 'error').mockImplementation(() => {})
    state.invoke.mockRejectedValue(new Error('no session'))
    __createTauriAPIForTests().connect.rdpDisconnect('r1')
    await Promise.resolve()
    await Promise.resolve()
    expect(error).toHaveBeenCalledWith('[omnitermAPI] rdpDisconnect failed', expect.any(Error))
  })

  it('reports each shells.ready command failure separately', async () => {
    const warn = vi.spyOn(diag, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(diag, 'error').mockImplementation(() => {})
    state.invoke.mockRejectedValue(new Error('launcher refused'))
    __createTauriAPIForTests().shells.ready()
    await Promise.resolve()
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith(
      '[omnitermAPI] could not write launcher shims',
      expect.any(Error),
    )
    expect(error).toHaveBeenCalledWith('[omnitermAPI] shells_ready failed', expect.any(Error))
  })
})

describe('session subscriptions', () => {
  it('adapts every session event to the shape its caller expects', () => {
    const api = __createTauriAPIForTests()
    const ready = vi.fn()
    const data = vi.fn()
    const failed = vi.fn()
    const closed = vi.fn()
    const activity = vi.fn()

    api.connect.onLocalReady('s1', ready)
    api.connect.onLocalData('s1', data)
    api.connect.onLocalError('s1', failed)
    api.connect.onLocalClosed('s1', closed)
    api.connect.onLocalActivity('s1', activity)
    // The SSH wrappers drop the payload their local counterparts forward.
    api.connect.onSSHReady('s1', ready)
    api.connect.onSSHClosed('s1', closed)

    const fire = (kind: string, payload: unknown) => {
      for (const handler of state.sessionHandlers.filter((item) => item.kind === kind)) {
        handler.cb(payload)
      }
    }
    fire('ready', 'pane-label')
    fire('data', new Uint8Array([1]))
    fire('error', 'boom')
    fire('closed', 3)
    fire('activity', true)

    expect(ready).toHaveBeenCalledWith('pane-label')
    expect(ready).toHaveBeenCalledWith()
    expect(data).toHaveBeenCalledWith(new Uint8Array([1]))
    expect(failed).toHaveBeenCalledWith('boom')
    expect(closed).toHaveBeenCalledWith(3)
    expect(closed).toHaveBeenCalledWith()
    expect(activity).toHaveBeenCalledWith(true)
  })
})

describe('connect.ssh', () => {
  it('passes an explicit dark-mode flag through to the session', async () => {
    const api = __createTauriAPIForTests()
    await api.connect.ssh('s1', true)
    expect(state.startSession).toHaveBeenCalledWith('s1', 's1', 'cmd', true)
  })

  it('reports a non-Error rejection verbatim', async () => {
    state.invoke.mockRejectedValueOnce('prepare refused')
    await __createTauriAPIForTests().connect.ssh('s1')
    expect(state.failSession).toHaveBeenCalledWith('s1', 'prepare refused')
  })
})

describe('connect.rdp', () => {
  it('reports an Error rejection with its message', async () => {
    state.invoke.mockRejectedValueOnce(new Error('mstsc missing'))
    await expect(__createTauriAPIForTests().connect.rdp('r1'))
      .resolves.toEqual({ ok: false, error: 'mstsc missing' })
  })

  it('reports a non-Error rejection stringified', async () => {
    state.invoke.mockRejectedValueOnce('mstsc missing')
    await expect(__createTauriAPIForTests().connect.rdp('r1'))
      .resolves.toEqual({ ok: false, error: 'mstsc missing' })
  })
})

describe('initTauriBridge', () => {
  const internals = '__TAURI_INTERNALS__'

  afterEach(() => {
    delete (window as any)[internals]
    delete (window as any).omnitermAPI
  })

  it('does nothing outside Tauri', () => {
    initTauriBridge()
    expect((window as any).omnitermAPI).toBeUndefined()
  })

  it('installs the bridge inside Tauri', () => {
    (window as any)[internals] = {}
    initTauriBridge()
    expect((window as any).omnitermAPI).toBeDefined()
  })

  it('reports a construction failure instead of throwing at startup', () => {
    const error = vi.spyOn(diag, 'error').mockImplementation(() => {})
    ;(window as any)[internals] = {}
    // Nothing inside `createTauriAPI` can be made to throw from out here — it only builds an object
    // literal. The `diag.log` that follows it is inside the same `try`, so throwing from there is
    // what exercises the guard that keeps a bridge failure from taking down startup.
    const log = vi.spyOn(diag, 'log').mockImplementation(() => {
      throw new Error('bridge construction failed')
    })
    initTauriBridge()
    expect(error).toHaveBeenCalledWith(
      '[omnitermAPI] Failed to initialize bridge:',
      expect.any(Error),
    )
    log.mockRestore()
  })
})
