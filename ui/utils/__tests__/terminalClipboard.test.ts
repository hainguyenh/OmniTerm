/**
 * @vitest-environment jsdom
 */
import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNativePasteGate, createTerminalClipboard } from '../terminalClipboard'

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
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: { writeText, readText: vi.fn(), readImage: async () => null, saveImageTemp: vi.fn() },
    }

    const clipboard = createTerminalClipboard(term)
    await clipboard.copySelection()

    expect(writeText).toHaveBeenCalledWith('agent output')
    expect(browserWrite).toHaveBeenCalledWith('agent output')
    clipboard.dispose()
  })

  it('inserts a temp-file path when the clipboard holds an image instead of text', async () => {
    const pngItem = {
      types: ['image/png'],
      getType: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [pngItem] },
    })
    const saveImageTemp = vi.fn().mockResolvedValue('C:/temp/omniterm-paste-1.png')
    const onBeforePaste = vi.fn()
    const term = {
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: { writeText: vi.fn(), readText: async () => '', readImage: async () => null, saveImageTemp },
    }

    const clipboard = createTerminalClipboard(term, onBeforePaste)
    await clipboard.paste()

    expect(saveImageTemp).toHaveBeenCalledOnce()
    expect(term.paste).toHaveBeenCalledWith('C:/temp/omniterm-paste-1.png')
    expect(onBeforePaste).toHaveBeenCalled()
    clipboard.dispose()
  })

  it('falls back to the native plugin when the WebView denies clipboard.read', async () => {
    // WebView2's default: navigator.clipboard.read() rejects instead of listing items.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => { throw new Error('Read permission denied.') } },
    })
    const saveImageTemp = vi.fn().mockResolvedValue('C:/temp/omniterm-paste-2.png')
    const term = {
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: {
        writeText: vi.fn(),
        readText: async () => '',
        // One red pixel, as the native plugin delivers it.
        readImage: async () => ({ rgba: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 }),
        saveImageTemp,
      },
    }
    const putImageData = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData,
    } as unknown as CanvasRenderingContext2D)
    HTMLCanvasElement.prototype.toBlob = function toBlob(
      this: HTMLCanvasElement,
      callback: (blob: Blob | null) => void,
    ) {
      callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
      return null
    } as typeof HTMLCanvasElement.prototype.toBlob

    const clipboard = createTerminalClipboard(term)
    await clipboard.paste()

    expect(saveImageTemp).toHaveBeenCalledOnce()
    expect(saveImageTemp.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array)
    expect(term.paste).toHaveBeenCalledWith('C:/temp/omniterm-paste-2.png')
    clipboard.dispose()
  })

  it('still pastes an image when the text read rejects on an image-only clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const saveImageTemp = vi.fn().mockResolvedValue('C:/temp/omniterm-paste-3.png')
    const term = {
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: {
        writeText: vi.fn(),
        // The plugin throws when no text flavor is present — this must not abort the paste.
        readText: async () => { throw new Error('no text on clipboard') },
        readImage: async () => ({ rgba: new Uint8Array([0, 255, 0, 255]), width: 1, height: 1 }),
        saveImageTemp,
      },
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    HTMLCanvasElement.prototype.toBlob = function toBlob(
      this: HTMLCanvasElement,
      callback: (blob: Blob | null) => void,
    ) {
      callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
      return null
    } as typeof HTMLCanvasElement.prototype.toBlob

    const clipboard = createTerminalClipboard(term)
    await clipboard.paste()

    expect(term.paste).toHaveBeenCalledWith('C:/temp/omniterm-paste-3.png')
    clipboard.dispose()
  })

  it('pastes nothing when neither reader finds an image and there is no text', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const term = {
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: {
        writeText: vi.fn(),
        readText: async () => '',
        readImage: async () => null,
        saveImageTemp: vi.fn(),
      },
    }

    const clipboard = createTerminalClipboard(term)
    await clipboard.paste()

    expect(term.paste).not.toHaveBeenCalled()
    clipboard.dispose()
  })

  it('leaves an image-only clipboard untouched when path insertion is disabled', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const saveImageTemp = vi.fn()
    const term = {
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: {
        writeText: vi.fn(),
        readText: async () => '',
        // An image IS on the clipboard; the pane opted out of the path contract.
        readImage: async () => ({ rgba: new Uint8Array([0, 0, 255, 255]), width: 1, height: 1 }),
        saveImageTemp,
      },
    }
    const onBeforePaste = vi.fn()

    const clipboard = createTerminalClipboard(term, onBeforePaste, () => false)
    await clipboard.paste()

    expect(saveImageTemp).not.toHaveBeenCalled()
    expect(term.paste).not.toHaveBeenCalled()
    expect(onBeforePaste).not.toHaveBeenCalled()
    clipboard.dispose()
  })

  it('only sends one paste when clipboard reads overlap', async () => {
    let resolveRead: ((text: string) => void) | undefined
    const readText = vi.fn(() => new Promise<string>(resolve => { resolveRead = resolve }))
    const term = {
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = { ...window.omnitermAPI, clipboard: { writeText: vi.fn(), readText, readImage: async () => null, saveImageTemp: vi.fn() } }

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
    window.omnitermAPI = { ...window.omnitermAPI, clipboard: { writeText, readText: vi.fn(), readImage: async () => null, saveImageTemp: vi.fn() } }

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
    window.omnitermAPI = { ...window.omnitermAPI, clipboard: { writeText, readText: vi.fn(), readImage: async () => null, saveImageTemp: vi.fn() } }

    const clipboard = createTerminalClipboard(term)
    selectionCb?.()
    vi.advanceTimersByTime(200)

    expect(writeText).not.toHaveBeenCalled()
    clipboard.dispose()
  })

  it('reports saved bytes and path through onImageSaved (web reader path)', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71])
    const pngItem = {
      types: ['image/png'],
      getType: async () => new Blob([pngBytes], { type: 'image/png' }),
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [pngItem] },
    })
    const saveImageTemp = vi.fn().mockResolvedValue('C:/temp/omniterm-paste-6.png')
    const onImageSaved = vi.fn()
    const term = {
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: { writeText: vi.fn(), readText: async () => '', readImage: async () => null, saveImageTemp },
    }

    const clipboard = createTerminalClipboard(term, undefined, () => true, onImageSaved)
    await clipboard.paste()
    await vi.waitFor(() => expect(onImageSaved).toHaveBeenCalled())

    expect(onImageSaved).toHaveBeenCalledWith({ bytes: pngBytes, path: 'C:/temp/omniterm-paste-6.png' })
    expect(term.paste).toHaveBeenCalledWith('C:/temp/omniterm-paste-6.png')
    clipboard.dispose()
  })

  it('gate reports saved bytes and path through onImageSaved', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71])
    const imageItem = { type: 'image/png', getAsFile: () => new Blob([pngBytes], { type: 'image/png' }) }
    const event = {
      clipboardData: { items: [imageItem] },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as ClipboardEvent
    const saveImageTemp = vi.fn().mockResolvedValue('C:/temp/omniterm-paste-7.png')
    const onImageSaved = vi.fn()
    const term = { paste: vi.fn() } as unknown as Terminal
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: { writeText: vi.fn(), readText: vi.fn(), readImage: vi.fn(), saveImageTemp },
    }

    const gate = createNativePasteGate({
      term,
      noteLocalEcho: vi.fn(),
      isSuppressed: () => false,
      onImageSaved,
    })
    gate(event)
    await vi.waitFor(() => expect(onImageSaved).toHaveBeenCalled())

    expect(onImageSaved).toHaveBeenCalledWith({ bytes: pngBytes, path: 'C:/temp/omniterm-paste-7.png' })
    expect(term.paste).toHaveBeenCalledWith('C:/temp/omniterm-paste-7.png')
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('omitting onImageSaved keeps paste behavior unchanged (regression guard)', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71])
    const pngItem = {
      types: ['image/png'],
      getType: async () => new Blob([pngBytes], { type: 'image/png' }),
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [pngItem] },
    })
    const saveImageTemp = vi.fn().mockResolvedValue('C:/temp/omniterm-paste-8.png')
    const onBeforePaste = vi.fn()
    const term = {
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      paste: vi.fn(),
    } as unknown as Terminal
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: { writeText: vi.fn(), readText: async () => '', readImage: async () => null, saveImageTemp },
    }

    const clipboard = createTerminalClipboard(term, onBeforePaste)
    await clipboard.paste()
    await vi.waitFor(() => expect(term.paste).toHaveBeenCalled())

    expect(term.paste).toHaveBeenCalledWith('C:/temp/omniterm-paste-8.png')
    expect(onBeforePaste).toHaveBeenCalled()
    clipboard.dispose()
  })
})
