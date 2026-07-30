/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { TOKYO_NIGHT } from '../../themes'
import { mockOmnitermAPI } from '../../testUtils'
import TerminalView from '../TerminalView'

const xterm = vi.hoisted(() => {
  const terminals: FakeTerminal[] = []
  const fits: FakeFitAddon[] = []

  class FakeFitAddon {
    fit = vi.fn()
    constructor() { fits.push(this) }
  }

  class FakeTerminal {
    options: Record<string, any>
    cols = 100
    rows = 30
    writes: string[] = []
    selection = ''
    dataHandler: ((data: string) => void) | null = null
    selectionHandler: (() => void) | null = null
    keyHandler: ((event: KeyboardEvent) => boolean) | null = null
    loadAddon = vi.fn()
    open = vi.fn()
    focus = vi.fn()
    dispose = vi.fn()
    selectionDispose = vi.fn()

    constructor(options: Record<string, any>) {
      this.options = { ...options }
      terminals.push(this)
    }

    write = vi.fn((text: string) => { this.writes.push(text) })
    onData = vi.fn((cb: (data: string) => void) => { this.dataHandler = cb })
    onSelectionChange = vi.fn((cb: () => void) => {
      this.selectionHandler = cb
      return { dispose: this.selectionDispose }
    })
    getSelection = vi.fn(() => this.selection)
    attachCustomKeyEventHandler = vi.fn((cb: (event: KeyboardEvent) => boolean) => {
      this.keyHandler = cb
    })
  }

  return { FakeFitAddon, FakeTerminal, terminals, fits }
})

vi.mock('@xterm/xterm', () => ({ Terminal: xterm.FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xterm.FakeFitAddon }))

interface Handlers {
  localReady?: (label?: string) => void
  localData?: (data: Uint8Array) => void
  localError?: (error: string) => void
  localClosed?: (code?: number) => void
  localActivity?: (busy: boolean) => void
  sshReady?: () => void
  sshData?: (data: Uint8Array) => void
  sshError?: (error: string) => void
  sshClosed?: () => void
  metrics?: (metrics: SessionMetrics) => void
}

const localConnection: Connection = {
  id: 'local-connection', name: 'PowerShell', type: 'LOCAL' as const, host: '', port: '', user: '', shell: 'powershell',
}
const sshConnection: Connection = {
  id: 'ssh-connection', name: 'Server', type: 'SSH' as const, host: 'server.test', port: '22', user: 'dev',
}

let handlers: Handlers
let cleanups: Array<ReturnType<typeof vi.fn>>
let resizeCallback: (() => void) | null

function subscription<K extends keyof Handlers>(key: K) {
  return vi.fn((_id: string, cb: NonNullable<Handlers[K]>) => {
    handlers[key] = cb
    const cleanup = vi.fn()
    cleanups.push(cleanup)
    return cleanup
  })
}

function installApi(resume: () => Promise<any> = async () => null) {
  mockOmnitermAPI({
    connect: {
      local: vi.fn(), localInput: vi.fn(), localResize: vi.fn(),
      onLocalReady: subscription('localReady'), onLocalData: subscription('localData'),
      onLocalError: subscription('localError'), onLocalClosed: subscription('localClosed'),
      onLocalActivity: subscription('localActivity'),
      ssh: vi.fn(), sshInput: vi.fn(), sshResize: vi.fn(),
      onSSHReady: subscription('sshReady'), onSSHData: subscription('sshData'),
      onSSHError: subscription('sshError'), onSSHClosed: subscription('sshClosed'),
      onSessionMetrics: subscription('metrics'),
    },
    terminalWindow: { resume: vi.fn(resume) },
    clipboard: { writeText: vi.fn(async () => {}), readText: vi.fn(async () => 'pasted text') },
  })
}

function key(code: string, patch: Partial<KeyboardEvent> = {}) {
  return { type: 'keydown', code, key: code.replace('Key', ''), ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...patch } as KeyboardEvent
}

beforeEach(() => {
  handlers = {}
  cleanups = []
  resizeCallback = null
  xterm.terminals.length = 0
  xterm.fits.length = 0
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: () => void) { resizeCallback = cb }
    observe = vi.fn()
    disconnect = vi.fn()
    unobserve = vi.fn()
  })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 7 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TerminalView full lifecycle', () => {
  it('runs a local shell, handles clipboard, shortcuts, font sizing, activity, exit, and cleanup', async () => {
    installApi()
    const onStatus = vi.fn()
    const onActivity = vi.fn()
    const onExit = vi.fn()
    const onFontSizeChange = vi.fn()
    const { container, rerender, unmount } = render(
      <TerminalView id="local-session" connection={localConnection} onStatus={onStatus}
        onActivity={onActivity} onExit={onExit} onFontSizeChange={onFontSizeChange}
        theme={TOKYO_NIGHT.terminal.dark} fontSize={14} smartColors />,
    )
    const term = xterm.terminals[0]
    const fit = xterm.fits[0]
    const element = container.querySelectorAll('.h-full.w-full')[1] as HTMLElement

    expect(window.omnitermAPI.connect.local).toHaveBeenCalledWith('local-session', 'local-connection', 'powershell')
    expect(onStatus).toHaveBeenCalledWith('connecting')
    act(() => handlers.localReady?.('PowerShell 7'))
    expect(onStatus).not.toHaveBeenCalledWith('connected')
    expect(term.writes.join('')).toContain('PowerShell 7')

    act(() => handlers.localData?.(new TextEncoder().encode('success 123')))
    expect(onStatus).toHaveBeenCalledWith('connected')
    expect(term.writes.join('')).toContain('success')
    act(() => term.dataHandler?.('dir\r'))
    expect(window.omnitermAPI.connect.localInput).toHaveBeenCalledWith('local-session', 'dir\r')

    term.selection = 'selected text'
    act(() => term.selectionHandler?.())
    expect(window.omnitermAPI.clipboard.writeText).toHaveBeenCalledWith('selected text')
    fireEvent.contextMenu(element)
    await waitFor(() => expect(window.omnitermAPI.connect.localInput).toHaveBeenCalledWith('local-session', 'pasted text'))

    expect(term.keyHandler?.(key('KeyN', { ctrlKey: true }))).toBe(false)
    expect(term.keyHandler?.(key('KeyC', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(term.keyHandler?.(key('KeyV', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(term.keyHandler?.({ type: 'keyup' } as KeyboardEvent)).toBe(true)
    expect(term.keyHandler?.(key('KeyA'))).toBe(true)

    fireEvent.wheel(element, { ctrlKey: true, deltaY: -1 })
    expect(onFontSizeChange).toHaveBeenCalledWith(15)
    term.options.fontSize = 48
    fireEvent.wheel(element, { metaKey: true, deltaY: -1 })
    expect(onFontSizeChange).toHaveBeenCalledTimes(1)
    term.options.fontSize = 8
    fireEvent.wheel(element, { ctrlKey: true, deltaY: 1 })
    expect(onFontSizeChange).toHaveBeenCalledTimes(1)

    act(() => handlers.localActivity?.(true))
    expect(onActivity).toHaveBeenCalledWith(true)
    window.dispatchEvent(new CustomEvent('omniterm:focus-terminal', { detail: { id: 'other' } }))
    window.dispatchEvent(new CustomEvent('omniterm:focus-terminal', { detail: { id: 'local-session' } }))
    expect(term.focus).toHaveBeenCalled()
    act(() => resizeCallback?.())
    expect(fit.fit).toHaveBeenCalled()
    expect(window.omnitermAPI.connect.localResize).toHaveBeenCalledWith('local-session', { cols: 100, rows: 30 })

    rerender(<TerminalView id="local-session" connection={localConnection} onStatus={onStatus}
      onActivity={onActivity} onExit={onExit} onFontSizeChange={onFontSizeChange}
      theme={{ ...TOKYO_NIGHT.terminal.dark, selectionForeground: '' }} fontSize={18}
      fontFamilyMono="JetBrains Mono" smartColors={false} />)
    expect(term.options.fontSize).toBe(18)
    expect(term.options.fontFamily).toBe('JetBrains Mono')
    expect(term.options.theme.selectionForeground).toBeUndefined()

    act(() => handlers.localError?.('boom'))
    expect(onStatus).toHaveBeenCalledWith('error')
    act(() => handlers.localClosed?.(9))
    expect(onStatus).toHaveBeenCalledWith('closed')
    expect(onExit).toHaveBeenCalledWith(9)
    expect(term.options).toMatchObject({ cursorBlink: false, disableStdin: true })

    unmount()
    expect(term.selectionDispose).toHaveBeenCalled()
    expect(term.dispose).toHaveBeenCalled()
    for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalled()
  })

  it('runs SSH with ready status, metrics, clean close, and smart colors disabled', () => {
    installApi()
    const onStatus = vi.fn()
    const onMetrics = vi.fn()
    const onExit = vi.fn()
    render(<TerminalView id="ssh-connection" connection={sshConnection} onStatus={onStatus}
      onMetrics={onMetrics} onExit={onExit} smartColors={false} />)
    const term = xterm.terminals[0]

    expect(window.omnitermAPI.connect.ssh).toHaveBeenCalledWith('ssh-connection')
    act(() => handlers.sshReady?.())
    expect(onStatus).toHaveBeenCalledWith('connected')
    expect(term.writes.join('')).toContain('Connected to server.test')
    act(() => handlers.sshData?.(new TextEncoder().encode('error 42')))
    expect(term.writes.join('')).toContain('error 42')
    act(() => handlers.metrics?.({ latency: 21, cpu: 4, memUsed: 128, memTotal: 1024, diskUsedPct: 8, ts: Date.now() }))
    expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({ latency: 21 }))
    act(() => handlers.sshClosed?.())
    expect(onExit).toHaveBeenCalledWith(0)
    expect(term.writes.join('')).toContain('exit code 0')
  })

  it.each([
    ['missing', null, 'error'],
    ['ready', { status: 'ready', data: new TextEncoder().encode('restored') }, 'connected'],
    ['error', { status: 'error', error: 'resume failed', data: new Uint8Array() }, 'error'],
    ['closed', { status: 'closed', data: new Uint8Array() }, 'closed'],
  ])('attaches to a %s snapshot without reconnecting', async (_name: string, snapshot: any, finalStatus: any) => {
    installApi(async () => snapshot)
    const onStatus = vi.fn()
    render(<TerminalView id="existing" connection={sshConnection} mode="attach" onStatus={onStatus} />)
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith(finalStatus))
    expect(window.omnitermAPI.connect.ssh).not.toHaveBeenCalled()
    if (snapshot?.data?.length) expect(xterm.terminals[0].writes.join('')).toContain('restored')
    if (snapshot?.error) expect(xterm.terminals[0].writes.join('')).toContain('resume failed')
  })

  it('ignores a late attach result after unmount and tolerates hidden or unready terminals', async () => {
    let resolve!: (value: any) => void
    installApi(() => new Promise(r => { resolve = r }))
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(0)
    const { unmount } = render(<TerminalView id="late" connection={sshConnection} mode="attach" />)
    unmount()
    await act(async () => resolve({ status: 'ready', data: new Uint8Array() }))
    expect(xterm.terminals[0].writes).toHaveLength(0)
    width.mockReturnValue(640)
  })
})
