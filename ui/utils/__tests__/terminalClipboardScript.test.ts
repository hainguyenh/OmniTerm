/**
 * @vitest-environment jsdom
 */
import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'

import { formatPowerShellScriptForPaste } from '../paste'
import { createTerminalClipboard } from '../terminalClipboard'

describe('terminal clipboard: Ctrl+Alt+V script paste', () => {
  const scriptClipboard = (psScript: string) => {
    const term = {
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: {
        writeText: vi.fn(),
        readText: async () => psScript,
        readImage: async () => null,
        saveImageTemp: vi.fn(),
      },
    }
    return term
  }

  it('pasteScript wraps a multiline script as one PowerShell block in a PowerShell pane', async () => {
    const psScript = 'Get-Process | Where-Object { $_.CPU -gt 10 }\nWrite-Host "Done"'
    const onBeforePaste = vi.fn()
    const term = scriptClipboard(psScript)

    const clipboard = createTerminalClipboard(term, onBeforePaste)
    await clipboard.pasteScript(true)

    expect(term.paste).toHaveBeenCalledWith(formatPowerShellScriptForPaste(psScript))
    expect(term.paste).toHaveBeenCalledWith(expect.stringContaining(`\n${psScript}\n}`))
    expect(onBeforePaste).toHaveBeenCalled()
    clipboard.dispose()
  })

  it('pasteScript falls back to an ordinary paste outside a PowerShell prompt', async () => {
    const psScript = 'echo one\necho two'
    const term = scriptClipboard(psScript)

    const clipboard = createTerminalClipboard(term)
    await clipboard.pasteScript(false)

    expect(term.paste).toHaveBeenCalledWith(psScript)
    clipboard.dispose()
  })

  it('marks the pending block with a gutter only, and removes it once the block runs (regression: overlapping output)', async () => {
    vi.useFakeTimers()
    const decorations: Array<{ options: Record<string, unknown>; element: HTMLElement; dispose: ReturnType<typeof vi.fn> }> = []
    const dataListeners: Array<(data: string) => void> = []
    const term = {
      cols: 80,
      buffer: { active: { baseY: 0, cursorY: 3 } },
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      onData: vi.fn((listener: (data: string) => void) => { dataListeners.push(listener); return { dispose: vi.fn() } }),
      registerMarker: vi.fn(() => ({ line: 1, isDisposed: false, dispose: vi.fn() })),
      registerDecoration: vi.fn((options: Record<string, unknown>) => {
        const element = document.createElement('div')
        const decoration = { options, element, dispose: vi.fn(), onRender: (cb: (el: HTMLElement) => void) => cb(element) }
        decorations.push(decoration)
        return decoration
      }),
      paste: vi.fn((text: string) => dataListeners.forEach(listener => listener(text))),
    } as unknown as Terminal
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: { writeText: vi.fn(), readText: async () => 'Get-Date\nGet-Location', readImage: async () => null, saveImageTemp: vi.fn() },
    }

    const clipboard = createTerminalClipboard(term)
    await clipboard.pasteScript(true)
    await vi.advanceTimersByTimeAsync(2_000)

    // One thin bar and nothing over the text: no hint decoration on the script's last line.
    expect(decorations).toHaveLength(1)
    const [gutter] = decorations
    expect(gutter.options).toMatchObject({ x: 0, width: 1, height: 3 })
    expect(gutter.element.classList.contains('pasted-script-gutter')).toBe(true)
    expect(gutter.element.textContent).toBe('')

    // The paste's own CRs keep it; an arrow key (ESC-prefixed) keeps it; the user's Enter removes it,
    // so the script's output (or its Clear-Host) never sits under a stale bar.
    expect(gutter.dispose).not.toHaveBeenCalled()
    dataListeners.forEach(listener => listener('\x1b[A'))
    expect(gutter.dispose).not.toHaveBeenCalled()
    dataListeners.forEach(listener => listener('\r'))
    expect(gutter.dispose).toHaveBeenCalled()
    clipboard.dispose()
    vi.useRealTimers()
  })
})
