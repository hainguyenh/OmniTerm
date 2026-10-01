/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockOmnitermAPI } from '../../testUtils'
import { openHiddenTerminal } from '../hiddenTerminal'

const { FakeTerminal, getLastTerminal } = vi.hoisted(() => {
  const terminals: FakeTerminal[] = []

  class FakeTerminal {
    cols = 120
    rows = 4
    buffer = {
      active: {
        baseY: 0,
        getLine: (idx: number) => {
          if (idx === 1) return undefined
          return { translateToString: () => `line-${idx}` }
        },
      },
    }
    onDataHandler: ((data: string) => void) | null = null
    repliesDispose = vi.fn()
    onData = vi.fn((cb: (data: string) => void) => {
      this.onDataHandler = cb
      return { dispose: this.repliesDispose }
    })
    write = vi.fn()
    dispose = vi.fn()

    constructor() {
      terminals.push(this)
    }
  }

  return { FakeTerminal, getLastTerminal: () => terminals[terminals.length - 1] ?? null }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: FakeTerminal,
}))

describe('openHiddenTerminal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockOmnitermAPI()
  })

  it('returns null when window.omnitermAPI is undefined or shells.open fails', async () => {
    const originalApi = window.omnitermAPI
    try {
      Object.defineProperty(window, 'omnitermAPI', { value: undefined, configurable: true, writable: true })
      expect(await openHiddenTerminal('/test')).toBeNull()

      mockOmnitermAPI({
        shells: {
          open: vi.fn().mockRejectedValue(new Error('Shell launch failed')),
        },
      })
      expect(await openHiddenTerminal('/test')).toBeNull()

      mockOmnitermAPI({
        shells: {
          open: vi.fn().mockResolvedValue(null),
        },
      })
      expect(await openHiddenTerminal('/test')).toBeNull()

      mockOmnitermAPI({
        shells: {
          open: vi.fn().mockResolvedValue({ id: 123 }),
        },
      })
      expect(await openHiddenTerminal('/test')).toBeNull()
    } finally {
      Object.defineProperty(window, 'omnitermAPI', { value: originalApi, configurable: true, writable: true })
    }
  })

  it('returns null and cleans up when connect.local rejects', async () => {
    const releaseMock = vi.fn()
    mockOmnitermAPI({
      shells: {
        open: vi.fn().mockResolvedValue({ id: 'shell-conn-1' }),
        release: releaseMock,
      },
      connect: {
        local: vi.fn().mockRejectedValue(new Error('connection failed')),
        localDisconnect: vi.fn(),
      },
    })

    const term = await openHiddenTerminal('/tmp')
    expect(term).toBeNull()
    expect(releaseMock).toHaveBeenCalledWith('shell-conn-1')
    expect(getLastTerminal()?.dispose).toHaveBeenCalled()
  })

  it('opens successfully, supports send, output, screen, and idempotent close', async () => {
    let fireReady: (() => void) | undefined
    let fireData: ((bytes: Uint8Array) => void) | undefined
    const localInputMock = vi.fn()
    const localResizeMock = vi.fn()
    const localDisconnectMock = vi.fn()
    const releaseMock = vi.fn()

    mockOmnitermAPI({
      shells: {
        open: vi.fn().mockResolvedValue({ id: 'shell-conn-2' }),
        release: releaseMock,
      },
      connect: {
        local: vi.fn().mockImplementation(async () => {
          fireReady?.()
        }),
        localInput: localInputMock,
        localResize: localResizeMock,
        localDisconnect: localDisconnectMock,
        onLocalReady: vi.fn((_id: string, cb: () => void) => {
          fireReady = cb
          return () => {}
        }),
        onLocalData: vi.fn((_id: string, cb: (bytes: Uint8Array) => void) => {
          fireData = cb
          return () => {}
        }),
        onLocalClosed: vi.fn(() => () => {}),
      },
    })

    const term = await openHiddenTerminal('/test/path')

    expect(term).not.toBeNull()
    expect(localResizeMock).toHaveBeenCalledWith(expect.any(String), { cols: 120, rows: 40 })

    // Replies from xterm onData
    getLastTerminal()?.onDataHandler?.('query response')
    expect(localInputMock).toHaveBeenCalledWith(expect.any(String), 'query response')

    // Screen reading
    const lines = term!.screen()
    expect(lines).toEqual(['line-0', '', 'line-2', 'line-3'])

    // Send
    term!.send('user input\n')
    expect(localInputMock).toHaveBeenCalledWith(expect.any(String), 'user input\n')

    // onOutput listener
    const outputs: string[] = []
    const unsub = term!.onOutput((text) => outputs.push(text))
    fireData?.(new TextEncoder().encode('stdout data'))
    expect(outputs).toEqual(['stdout data'])
    expect(getLastTerminal()?.write).toHaveBeenCalled()

    // Unsubscribe
    unsub()
    fireData?.(new TextEncoder().encode('more data'))
    expect(outputs).toEqual(['stdout data'])

    // Close
    await term!.close()
    expect(localDisconnectMock).toHaveBeenCalled()
    expect(releaseMock).toHaveBeenCalledWith('shell-conn-2')
    expect(getLastTerminal()?.dispose).toHaveBeenCalled()

    // Second close is no-op
    localDisconnectMock.mockClear()
    await term!.close()
    expect(localDisconnectMock).not.toHaveBeenCalled()
  })

  it('marks ready when onLocalClosed fires during initialization', async () => {
    let fireClosed: (() => void) | undefined
    mockOmnitermAPI({
      shells: {
        open: vi.fn().mockResolvedValue({ id: 'shell-conn-3' }),
        release: vi.fn(),
      },
      connect: {
        local: vi.fn().mockImplementation(async () => {
          fireClosed?.()
        }),
        onLocalReady: vi.fn(() => () => {}),
        onLocalClosed: vi.fn((_id: string, cb: () => void) => {
          fireClosed = cb
          return () => {}
        }),
      },
    })

    const term = await openHiddenTerminal()
    expect(term).not.toBeNull()
    await term?.close()
  })
})
