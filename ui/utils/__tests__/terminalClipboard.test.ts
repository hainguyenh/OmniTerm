/**
 * @vitest-environment jsdom
 */
import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import { createTerminalClipboard } from '../terminalClipboard'

describe('terminal clipboard', () => {
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
})
