/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { WebglAddon } from '@xterm/addon-webgl'
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
    unicode = { activeVersion: '6' }
    // Enough of the buffer API for the visibility effect to decide whether the pane was pinned to
    // the live tail. viewportY === baseY means "at the bottom".
    buffer = { active: { viewportY: 0, baseY: 0 } }
    dataHandler: ((data: string) => void) | null = null
    selectionHandler: (() => void) | null = null
    keyHandler: ((event: KeyboardEvent) => boolean) | null = null
    loadAddon = vi.fn()
    open = vi.fn()
    focus = vi.fn()
    scrollToBottom = vi.fn()
    dispose = vi.fn()
    selectionDispose = vi.fn()

    constructor(options: Record<string, any>) {
      this.options = { ...options }
      terminals.push(this)
    }

    write = vi.fn((text: string) => { this.writes.push(text) })
    // Mirrors the real Terminal.paste: normalize CRLF -> CR, then hand off through onData. Keeping
    // that shape here is the point of the mock — it is how we can tell one write from two.
    paste = vi.fn((text: string) => { this.dataHandler?.(text.replace(/\r?\n/g, '\r')) })
    input = vi.fn((data: string) => { this.dataHandler?.(data) })
    refresh = vi.fn()
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
  return {
    type: 'keydown', code, key: code.replace('Key', ''),
    ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    // Spies, not no-ops: the duplicate-paste bug was precisely a missing preventDefault(), so the
    // tests below assert it was called rather than just that the handler returned false.
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
    ...patch,
  } as unknown as KeyboardEvent
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
  it('passes the selected appearance mode to a new local session', () => {
    installApi()
    render(
      <TerminalView id="light-session" connection={localConnection} darkMode={false} />,
    )
    expect(window.omnitermAPI.connect.local).toHaveBeenCalledWith(
      'light-session', 'local-connection', 'powershell', false,
    )
  })

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

    // Async act flushes the scrollback gate that holds output until the store read resolves.
    await act(async () => { handlers.localData?.(new TextEncoder().encode('success 123')) })
    expect(onStatus).toHaveBeenCalledWith('connected')
    expect(term.writes.join('')).toContain('success')
    act(() => term.dataHandler?.('dir\r'))
    expect(window.omnitermAPI.connect.localInput).toHaveBeenCalledWith('local-session', 'dir\r')

    term.selection = 'selected text'
    act(() => term.selectionHandler?.())
    await waitFor(() => expect(window.omnitermAPI.clipboard.writeText).toHaveBeenCalledWith('selected text'))
    fireEvent.contextMenu(element)
    await waitFor(() => expect(window.omnitermAPI.connect.localInput).toHaveBeenCalledWith('local-session', 'pasted text'))

    // Ctrl+N is a bare-Ctrl shell/agent default (e.g. readline's next-history), so a focused
    // terminal now wins it back from the app's "new session" shortcut — xterm handles it (true).
    expect(term.keyHandler?.(key('KeyN', { ctrlKey: true }))).toBe(true)
    // Ctrl+Shift+N can't collide with a bare-Ctrl shell default, so it still bubbles to the app.
    expect(term.keyHandler?.(key('KeyN', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(term.keyHandler?.(key('KeyC', { ctrlKey: true, shiftKey: true }))).toBe(false)

    // Every clipboard combo must preventDefault, or Chromium's native paste fires on top of ours and
    // the PTY gets the clipboard twice.
    for (const combo of [{ ctrlKey: true }, { ctrlKey: true, shiftKey: true }]) {
      const ev = key('KeyV', combo)
      expect(term.keyHandler?.(ev)).toBe(false)
      expect(ev.preventDefault).toHaveBeenCalled()
      expect(ev.stopPropagation).toHaveBeenCalled()
    }

    // Shift+Enter / Ctrl+Enter must reach the PTY as distinct sequences — xterm would flatten both
    // to a bare CR, leaving an AI agent unable to tell them from a plain Enter.
    const shiftEnter = key('Enter', { shiftKey: true })
    expect(term.keyHandler?.(shiftEnter)).toBe(false)
    expect(shiftEnter.preventDefault).toHaveBeenCalled()
    expect(window.omnitermAPI.connect.localInput).toHaveBeenCalledWith('local-session', '\x1b\r')
    expect(term.keyHandler?.(key('Enter', { ctrlKey: true }))).toBe(false)
    expect(window.omnitermAPI.connect.localInput).toHaveBeenCalledWith('local-session', '\n')
    // Plain and Alt+Enter stay xterm's business.
    expect(term.keyHandler?.(key('Enter'))).toBe(true)
    expect(term.keyHandler?.(key('Enter', { altKey: true }))).toBe(true)

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

  // The backend pushes a session's whole buffered scrollback (up to 256 KiB) down the data channel
  // during attach_session, before resume() resolves. Colorizing that with an 8-alternation regex and
  // then handing it to xterm as one atomic parse is what froze the app on attach/detach.
  it('writes an attach replay in chunks and does not run smart colors over it', async () => {
    let resolveResume!: (value: any) => void
    installApi(() => new Promise(r => { resolveResume = r }))
    render(<TerminalView id="replaying" connection={sshConnection} mode="attach" smartColors />)
    const term = xterm.terminals[0]

    // Arrives while resume() is still in flight — that is what marks it as the replay. 'error' would
    // normally be wrapped in a red SGR pair by the highlighter.
    const replay = `error at ${'y'.repeat(40 * 1024)}\n`
    await act(async () => { handlers.sshData?.(new TextEncoder().encode(replay)) })
    expect(term.writes.length).toBeGreaterThan(1)
    expect(term.writes.join('')).toBe(replay)

    // Live output after the attach settles gets the normal treatment again.
    await act(async () => { resolveResume({ status: 'ready', data: new Uint8Array() }) })
    term.writes.length = 0
    await act(async () => { handlers.sshData?.(new TextEncoder().encode('error now')) })
    expect(term.writes.join('')).toContain('\x1b[91merror\x1b[39m')
  })

  // The output highlighter must not rewrite a paste's echo: an agent CLI re-wraps and repositions the
  // echoed block by coordinate, and injected SGR codes throw off its cell accounting — that is the
  // overlapping text a long paste produced. See OutputHighlighter.noteLocalEcho.
  it('quiets smart colors over the echo of a paste', async () => {
    installApi()
    const { container } = render(<TerminalView id="echo-session" connection={localConnection} smartColors />)
    // The inner div is the one xterm opens into, and the one the contextmenu handler is bound to.
    const element = container.querySelectorAll('.h-full.w-full')[1] as HTMLElement
    const term = xterm.terminals[0]

    await act(async () => { handlers.localData?.(new TextEncoder().encode('error one')) })
    expect(term.writes.join('')).toContain('\x1b[91merror\x1b[39m')

    fireEvent.contextMenu(element)
    await waitFor(() => expect(window.omnitermAPI.connect.localInput).toHaveBeenCalledWith('echo-session', 'pasted text'))

    term.writes.length = 0
    await act(async () => { handlers.localData?.(new TextEncoder().encode('error two')) })
    expect(term.writes.join('')).toBe('error two')
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

  it('focuses and re-pins to the tail only on the hidden→visible edge', () => {
    installApi()
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    const { rerender } = render(<TerminalView id="vis" connection={localConnection} active={false} />)
    const term = xterm.terminals[0]
    expect(term.focus).not.toHaveBeenCalled()
    expect(term.loadAddon.mock.calls.filter((args: unknown[]) => args[0] instanceof WebglAddon)).toHaveLength(0)

    rerender(<TerminalView id="vis" connection={localConnection} active />)
    expect(term.focus).toHaveBeenCalled()
    expect(term.scrollToBottom).toHaveBeenCalledTimes(1)
    expect(term.loadAddon.mock.calls.filter((args: unknown[]) => args[0] instanceof WebglAddon)).toHaveLength(1)

    term.buffer.active.baseY = 500
    rerender(<TerminalView id="vis" connection={localConnection} active={false} />)
    rerender(<TerminalView id="vis" connection={localConnection} active />)
    expect(term.scrollToBottom).toHaveBeenCalledTimes(1)
    width.mockReturnValue(640)
  })

  it('refits and repaints when the layout mode changes while the pane stays visible', () => {
    installApi()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    const { rerender } = render(<TerminalView id="layout-epoch" connection={localConnection} active layoutEpoch="1:0" />)
    const fit = xterm.fits[0].fit
    fit.mockClear()

    rerender(<TerminalView id="layout-epoch" connection={localConnection} active layoutEpoch="2:0" />)

    expect(fit).toHaveBeenCalled()
  })

  it('loads the WebGL addon once and holds it across visibility changes', () => {
    installApi()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const disposeSpy = vi.spyOn(WebglAddon.prototype, 'dispose')
      const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
      const { rerender, unmount } = render(<TerminalView id="webgl-session" connection={localConnection} />)
      const term = xterm.terminals[0]
      const webglLoadCount = () => term.loadAddon.mock.calls.filter((args: unknown[]) => args[0] instanceof WebglAddon).length

      expect(webglLoadCount()).toBe(1)

      // Off screen and back. The ResizeObserver callback goes through the coalescer
      // (utils/coalesce.ts), which defers the real fit by a trailing timeout.
      rerender(<TerminalView id="webgl-session" connection={localConnection} active={false} />)
      act(() => { resizeCallback?.(); vi.runOnlyPendingTimers() })
      rerender(<TerminalView id="webgl-session" connection={localConnection} active />)
      act(() => { resizeCallback?.(); vi.runOnlyPendingTimers() })
      expect(disposeSpy).not.toHaveBeenCalled()
      expect(webglLoadCount()).toBe(1)

      unmount()
      expect(disposeSpy).toHaveBeenCalledTimes(1)
      width.mockReturnValue(640)
    } finally {
      vi.useRealTimers()
    }
  })

  // fit() already repaints when it changes cols/rows. Repainting a second time — and, as this used to,
  // throwing away every cached glyph with clearTextureAtlas() — on each of a drag-resize's frames is
  // the resize lag.
  it('repaints only when a fit changed the pixel size without changing cols/rows', () => {
    installApi()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
      render(<TerminalView id="refresh-session" connection={localConnection} />)
      const term = xterm.terminals[0]
      // The mount fit is the cols/rows-changing case (from the -1 sentinels), so it resizes the PTY
      // and leaves the repaint to xterm.
      expect(window.omnitermAPI.connect.localResize).toHaveBeenCalledTimes(1)
      expect(term.refresh).not.toHaveBeenCalled()

      // A redundant fit with exactly the same pixel size does nothing
      act(() => { resizeCallback?.(); vi.runOnlyPendingTimers() })
      expect(window.omnitermAPI.connect.localResize).toHaveBeenCalledTimes(1)
      expect(term.refresh).not.toHaveBeenCalled()

      // A fit where the pixel size changed but cols/rows didn't: no PTY resize, so we force a repaint.
      widthSpy.mockReturnValue(642)
      act(() => { resizeCallback?.(); vi.runOnlyPendingTimers() })
      expect(window.omnitermAPI.connect.localResize).toHaveBeenCalledTimes(1)
      expect(term.refresh).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // WebView zoom (App.tsx / DetachedTerminalWindow.tsx) changes CSS pixel density with no DOM
  // resize event, so without this a pane would keep drawing at the pre-zoom cell size.
  it('re-measures and refits on omniterm:zoom-changed', () => {
    installApi()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      render(<TerminalView id="zoom-session" connection={localConnection} />)
      const term = xterm.terminals[0]
      const fit = xterm.fits[0]
      const originalFamily = term.options.fontFamily
      fit.fit.mockClear()

      window.dispatchEvent(new CustomEvent('omniterm:zoom-changed'))
      // Restored, not left mutated — the toggle is only a trick to force xterm's option setter to
      // treat it as a change.
      expect(term.options.fontFamily).toBe(originalFamily)

      act(() => vi.runOnlyPendingTimers())
      // cols/rows are unchanged (the fake fit() is a no-op), so this proves the refit itself ran,
      // not that a resize was re-sent — that's covered by the dedup test below.
      expect(fit.fit).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  // Fonts loading asynchronously can cause xterm to measure fallback fonts initially.
  it('forces a re-measure when document.fonts.ready resolves', async () => {
    installApi()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let resolveFonts: (value: any) => void
    const fontsReadyPromise = new Promise(r => { resolveFonts = r })
    Object.defineProperty(document, 'fonts', {
      value: { ready: fontsReadyPromise },
      configurable: true
    })
    
    try {
      render(<TerminalView id="fonts-session" connection={localConnection} />)
      const fit = xterm.fits[0]
      fit.fit.mockClear()

      await act(async () => { resolveFonts({}) })
      act(() => vi.runOnlyPendingTimers())
      expect(fit.fit).toHaveBeenCalled()
    } finally {
      Object.defineProperty(document, 'fonts', { value: undefined, configurable: true })
      vi.useRealTimers()
    }
  })
})
