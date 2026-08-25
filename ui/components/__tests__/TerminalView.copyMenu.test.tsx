/**
 * @vitest-environment jsdom
 */
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { mockOmnitermAPI } from '../../testUtils'
import TerminalView from '../TerminalView'

const xterm = vi.hoisted(() => {
  const terminals: FakeTerminal[] = []

  class FakeFitAddon {
    fit = vi.fn()
  }

  class FakeTerminal {
    options: Record<string, any>
    cols = 80
    rows = 24
    unicode = { activeVersion: '6' }
    buffer: { active: any }
    dataHandler: ((data: string) => void) | null = null
    loadAddon = vi.fn()
    open = vi.fn()
    focus = vi.fn()
    scrollToBottom = vi.fn()
    dispose = vi.fn()

    constructor(options: Record<string, any>) {
      this.options = { ...options }
      this.buffer = { active: { length: 0, viewportY: 0, getLine: () => undefined } }
      terminals.push(this)
    }

    /** Point the active buffer at concrete lines, modelling PTY output having arrived. */
    setBufferLines = (lines: string[], viewportY: number) => {
      this.buffer.active = {
        length: lines.length,
        viewportY,
        getLine: (i: number) =>
          i >= 0 && i < lines.length ? { translateToString: () => lines[i] } : undefined,
      }
    }

    write = vi.fn()
    paste = vi.fn()
    input = vi.fn()
    refresh = vi.fn()
    onData = vi.fn((cb: (data: string) => void) => { this.dataHandler = cb })
    onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }))
    getSelection = vi.fn(() => '')
    attachCustomKeyEventHandler = vi.fn()
    onTitleChange = vi.fn(() => ({ dispose: vi.fn() }))
  }

  return { FakeFitAddon, FakeTerminal, terminals }
})

vi.mock('@xterm/xterm', () => ({ Terminal: xterm.FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xterm.FakeFitAddon }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class { activate() {} deactivate() {} } }))

const connection: Connection = {
  id: 'conn-1', name: 'Local', type: 'LOCAL', host: '', port: '', user: '', shell: 'powershell',
}

const writeText = vi.fn(async () => {})

beforeEach(() => {
  xterm.terminals.length = 0
  writeText.mockClear()
  mockOmnitermAPI({
    clipboard: { writeText, readText: vi.fn(async () => ''), readImage: async () => null },
  })
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const fireCopy = (sessionId: string, action: string) => {
  window.dispatchEvent(new CustomEvent('omniterm:copy-terminal', { detail: { sessionId, action } }))
}

describe('TerminalView copy menu wiring', () => {
  it('copies the prompt line plus output since the last Enter', () => {
    render(<TerminalView id="sess-1" connection={connection} mode="connect" />)
    const term = xterm.terminals[0]
    act(() => {
      term.setBufferLines(['ps> ls'], 0)
      term.dataHandler?.('\r')
      term.setBufferLines(['ps> ls', 'file-a', 'file-b'], 0)
      fireCopy('sess-1', 'last-output')
    })
    expect(writeText).toHaveBeenCalledWith('ps> ls\nfile-a')
  })

  it('copies only the visible viewport for the viewport action', () => {
    render(<TerminalView id="sess-1" connection={connection} mode="connect" />)
    const term = xterm.terminals[0]
    const lines = Array.from({ length: 40 }, (_, i) => `row-${i}`)
    act(() => {
      term.setBufferLines(lines, 38)
      fireCopy('sess-1', 'viewport')
    })
    // viewportY 38 with rows=24 reaches only to the end of a 40-line buffer.
    expect(writeText).toHaveBeenCalledWith('row-38\nrow-39')
  })

  it('ignores requests for other sessions, unknown actions, and empty extractions', () => {
    render(<TerminalView id="sess-1" connection={connection} mode="connect" />)
    const term = xterm.terminals[0]
    act(() => {
      term.setBufferLines(['ps> ls'], 0)
      fireCopy('sess-other', 'last-output')
      fireCopy('sess-1', 'bogus-action')
      fireCopy('sess-1', 'last-output') // No Enter recorded yet: empty extraction, no write.
    })
    expect(writeText).not.toHaveBeenCalled()
  })
})
