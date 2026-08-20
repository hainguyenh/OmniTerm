/**
 * @vitest-environment jsdom
 */
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { WebglAddon } from '@xterm/addon-webgl'
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

// Fit/resize, WebGL lifecycle, and re-measure behavior split out of TerminalView.coverage.test.tsx
// so neither file exceeds the .tsx LOC hard limit. The harness is duplicated here because vitest
// hoists vi.mock() above imports, so the fake xterm module and its factory must be colocated.
describe('TerminalView rendering & WebGL', () => {
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

  // Regression: the WebGL renderer must mount AFTER the first fit(). Loading it before fit()
  // committed its first frame at the default 80x24 grid; fit()'s resize repaint was then deduped
  // against that frame and left a freshly-launched full-screen TUI (claude, codex…) misaligned
  // until a font-size change forced a non-deduped repaint again. See the safeFit comment.
  it('loads the WebGL renderer after the first fit, not before', () => {
    installApi()
    render(<TerminalView id="load-order" connection={localConnection} />)
    const term = xterm.terminals[0]
    const fit = xterm.fits[0]
    const loadCalls = term.loadAddon.mock.calls
    const webglCallIndex = loadCalls.findIndex((args) => args[0] instanceof WebglAddon)
    expect(webglCallIndex).toBeGreaterThanOrEqual(0)
    const firstFitOrder = fit.fit.mock.invocationCallOrder[0]
    const webglLoadOrder = term.loadAddon.mock.invocationCallOrder[webglCallIndex]
    expect(firstFitOrder).toBeDefined()
    expect(webglLoadOrder).toBeGreaterThan(firstFitOrder)
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
      configurable: true,
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
