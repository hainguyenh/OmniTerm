/** @vitest-environment jsdom */
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diag } from '../../diag'
import { mockOmnitermAPI } from '../../testUtils'
import RDPView from '../RDPView'
import { rdpPlaceholderText } from '../rdpPlaceholder'

const connection = {
  id: 'rdp', name: 'Desktop', type: 'RDP' as const, host: 'desktop.test', port: '3389', user: 'operator',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

let resizeCallback: (() => void) | undefined
let disconnectObserver: any

beforeEach(() => {
  vi.useFakeTimers()
  resizeCallback = undefined
  disconnectObserver = vi.fn()
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { resizeCallback = () => callback([], this as unknown as ResizeObserver) }
    observe() {}
    unobserve() {}
    disconnect() { disconnectObserver() }
  } as unknown as typeof ResizeObserver
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 11, y: 22, width: 640, height: 480, top: 22, left: 11, right: 651, bottom: 502,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RDPView remaining lifecycle', () => {
  it('forwards close, latency, bounds, visibility, pane moves, and cleanup', async () => {
    let closeHandler: (() => void) | undefined
    let latencyHandler: ((latency: number | null) => void) | undefined
    const closeCleanup = vi.fn()
    const latencyCleanup = vi.fn()
    const rdpSetBounds = vi.fn()
    const rdpSetVisible = vi.fn()
    const rdpDisconnect = vi.fn()
    mockOmnitermAPI({
      connect: {
        rdp: vi.fn(async () => ({ ok: true })),
        onRDPClosed: vi.fn((_id: string, callback: () => void) => { closeHandler = callback; return closeCleanup }),
        onRDPLatency: vi.fn((_id: string, callback: (latency: number | null) => void) => { latencyHandler = callback; return latencyCleanup }),
        rdpSetBounds,
        rdpSetVisible,
        rdpDisconnect,
      },
    })
    const onStatus = vi.fn()
    const onLatency = vi.fn()
    const view = render(
      <RDPView id="session" connection={connection} active={false} paneEpoch="1:0" overlayActive={false}
        onStatus={onStatus} onLatency={onLatency} />,
    )

    expect(onStatus).toHaveBeenCalledWith('connecting')
    await act(async () => {})
    expect(onStatus).toHaveBeenCalledWith('connected')
    expect(rdpSetVisible).toHaveBeenCalledWith('session', false)
    expect(rdpSetBounds).toHaveBeenCalledWith('session', {
      x: 11, y: 22, width: 640, height: 480, dpr: window.devicePixelRatio,
    })

    act(() => latencyHandler?.(18))
    act(() => closeHandler?.())
    expect(onLatency).toHaveBeenCalledWith(18)
    expect(onStatus).toHaveBeenCalledWith('closed')

    view.rerender(
      <RDPView id="session" connection={connection} active paneEpoch="2:1" overlayActive={false}
        onStatus={onStatus} onLatency={onLatency} />,
    )
    expect(rdpSetVisible).toHaveBeenLastCalledWith('session', true)
    view.rerender(
      <RDPView id="session" connection={connection} active paneEpoch="2:1" overlayActive
        onStatus={onStatus} onLatency={onLatency} />,
    )
    expect(rdpSetVisible).toHaveBeenLastCalledWith('session', false)

    act(() => resizeCallback?.())
    act(() => window.dispatchEvent(new Event('resize')))
    act(() => vi.advanceTimersByTime(1800))
    expect(rdpSetBounds.mock.calls.length).toBeGreaterThan(3)

    view.unmount()
    expect(closeCleanup).toHaveBeenCalled()
    expect(latencyCleanup).toHaveBeenCalled()
    expect(disconnectObserver).toHaveBeenCalled()
    expect(rdpDisconnect).toHaveBeenCalledWith('session')
  })

  it('skips zero-size bounds and reports rejected connections only while mounted', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}),
    } as DOMRect)
    const pending = deferred<{ ok: boolean }>()
    const rdpSetBounds = vi.fn()
    const error = vi.spyOn(diag, 'error').mockImplementation(() => {})
    mockOmnitermAPI({ connect: { rdp: vi.fn(() => pending.promise), rdpSetBounds } })
    const onStatus = vi.fn()
    const view = render(<RDPView id="session" connection={connection} active overlayActive={false} onStatus={onStatus} />)
    act(() => resizeCallback?.())
    expect(rdpSetBounds).not.toHaveBeenCalled()
    view.unmount()
    await act(async () => pending.reject(new Error('late failure')))
    expect(error).not.toHaveBeenCalled()
    expect(onStatus).not.toHaveBeenCalledWith('error')
  })

  it('logs an active connection rejection and reports error', async () => {
    const failure = new Error('native launch failed')
    const error = vi.spyOn(diag, 'error').mockImplementation(() => {})
    mockOmnitermAPI({ connect: { rdp: vi.fn(async () => { throw failure }) } })
    const onStatus = vi.fn()
    render(<RDPView id="session" connection={connection} active overlayActive={false} onStatus={onStatus} />)
    await act(async () => {})
    expect(onStatus).toHaveBeenCalledWith('error')
    expect(error).toHaveBeenCalledWith('RDP connect error:', failure)
  })

  /** Regression: the pane stayed an empty black box while the client ran in its own window. */
  it('launches with the pane size and shows sign-in text until the client window docks', async () => {
    let dockedHandler: (() => void) | undefined
    const rdp = vi.fn(async () => ({ ok: true }))
    mockOmnitermAPI({
      connect: {
        rdp,
        onRDPDocked: vi.fn((_id: string, callback: () => void) => { dockedHandler = callback; return () => {} }),
      },
    })
    const view = render(<RDPView id="session" connection={connection} active overlayActive={false} />)
    expect(rdp).toHaveBeenCalledWith('session', {
      x: 11, y: 22, width: 640, height: 480, dpr: window.devicePixelRatio,
    })
    expect(view.container.textContent).toContain('Starting Remote Desktop for desktop.test')
    await act(async () => {})
    expect(view.container.textContent).toContain('Sign in from the Remote Desktop prompt')
    act(() => dockedHandler?.())
    expect(view.container.textContent).toBe('')
  })

  it('names an ended or failed session in the pane', () => {
    expect(rdpPlaceholderText('closed', 'desktop.test')).toBe('The Remote Desktop session has ended.')
    expect(rdpPlaceholderText('error', 'desktop.test')).toBe('Remote Desktop could not connect to desktop.test.')
  })
})
