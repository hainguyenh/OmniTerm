/**
 * @vitest-environment jsdom
 */
import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalClipboard } from '../terminalClipboard'

describe('terminal clipboard', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('falls back to the browser clipboard when the Tauri bridge rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard permission'))
    const browserWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: browserWrite } })
    const selection = vi.fn((callback: () => void) => ({ dispose: vi.fn(), callback }))
    const term = {
      getSelection: () => 'agent output',
      onSelectionChange: selection,
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = { ...window.omnitermAPI, clipboard: { writeText, readText: vi.fn() } }

    const clipboard = createTerminalClipboard(term)
    await clipboard.copySelection()

    expect(writeText).toHaveBeenCalledWith('agent output')
    expect(browserWrite).toHaveBeenCalledWith('agent output')
    clipboard.dispose()
  })

  it('only sends one paste when clipboard reads overlap', async () => {
    let resolveRead: ((text: string) => void) | undefined
    const readText = vi.fn(() => new Promise<string>(resolve => { resolveRead = resolve }))
    const term = {
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = { ...window.omnitermAPI, clipboard: { writeText: vi.fn(), readText } }

    const clipboard = createTerminalClipboard(term)
    const first = clipboard.paste()
    const second = clipboard.paste()
    resolveRead?.('once')
    await Promise.all([first, second])

    expect(readText).toHaveBeenCalledTimes(1)
    expect(term.paste).toHaveBeenCalledTimes(1)
    clipboard.dispose()
  })

  it('debounces onSelectionChange auto-copy so rapid drags write once', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    let selectionCb: (() => void) | undefined
    let currentSelection = ''
    const term = {
      getSelection: vi.fn(() => currentSelection),
      onSelectionChange: vi.fn((cb: () => void) => {
        selectionCb = cb
        return { dispose: vi.fn() }
      }),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = { ...window.omnitermAPI, clipboard: { writeText, readText: vi.fn() } }

    const clipboard = createTerminalClipboard(term)

    // Simulate a drag: selection changes rapidly
    currentSelection = 'H'
    selectionCb?.()
    currentSelection = 'He'
    selectionCb?.()
    currentSelection = 'Hello World'
    selectionCb?.()

    // No write yet — debounce has not settled
    expect(writeText).not.toHaveBeenCalled()

    // Advance past the 80 ms debounce
    await vi.advanceTimersByTimeAsync(80)

    // Only one write with the final selection
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('Hello World')

    clipboard.dispose()
  })

  it('skips auto-copy when selection is cleared (empty string)', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    let selectionCb: (() => void) | undefined
    const term = {
      getSelection: vi.fn(() => ''),
      onSelectionChange: vi.fn((cb: () => void) => {
        selectionCb = cb
        return { dispose: vi.fn() }
      }),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = { ...window.omnitermAPI, clipboard: { writeText, readText: vi.fn() } }

    const clipboard = createTerminalClipboard(term)
    selectionCb?.()
    vi.advanceTimersByTime(200)

    expect(writeText).not.toHaveBeenCalled()
    clipboard.dispose()
  })
})
