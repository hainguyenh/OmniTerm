/** @vitest-environment jsdom */
import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  saveAttachmentFiles: vi.fn(),
  installAttachmentDrop: vi.fn(),
  handleLargeTextPaste: vi.fn(),
  promptChars: 1000,
  formatScript: vi.fn(),
  markPastedScript: vi.fn(),
  dropDispose: vi.fn(),
}))

vi.mock('../attachmentInput', () => ({
  formatAttachmentPaths: (paths: string[]) => paths.join(' '),
  saveAttachmentFiles: (...args: unknown[]) => h.saveAttachmentFiles(...args),
  installAttachmentDrop: (...args: unknown[]) => h.installAttachmentDrop(...args),
}))
vi.mock('../largeTextPaste', () => ({
  handleLargeTextPaste: (...args: unknown[]) => h.handleLargeTextPaste(...args),
  largePasteThresholds: () => ({ promptChars: h.promptChars }),
  saveTextAsAttachment: async () => null,
}))
vi.mock('../paste', () => ({ formatPowerShellScriptForPaste: (text: string) => h.formatScript(text) }))
vi.mock('../pastedScriptDecoration', () => ({ markPastedScript: (...args: unknown[]) => h.markPastedScript(...args) }))

import { createNativePasteGate, createTerminalClipboard, writeClipboardText } from '../terminalClipboard'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeTerm(selection = '') {
  return {
    paste: vi.fn(),
    getSelection: () => selection,
    onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as Terminal & { paste: ReturnType<typeof vi.fn> }
}

function pasteEvent(init: { items?: Array<{ type: string; getAsFile: () => unknown }>; files?: File[]; text?: string }) {
  const event = new Event('paste', { cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: { items: init.items ?? [], files: init.files ?? [], getData: () => init.text ?? '' },
  })
  return event
}

function api(over: Record<string, unknown> = {}) {
  const clipboard = {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
    readImage: vi.fn().mockResolvedValue(null),
    saveImageTemp: vi.fn().mockResolvedValue('C:/tmp/a.png'),
    ...over,
  }
  window.omnitermAPI = { ...window.omnitermAPI, clipboard, attachments: { importClipboardFiles: vi.fn().mockResolvedValue([]) } } as never
  return clipboard
}

describe('createNativePasteGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.promptChars = 1000
    api()
  })

  it('swallows a paste its owner just wrote', () => {
    const term = makeTerm()
    const event = pasteEvent({ text: 'x' })
    createNativePasteGate({ term, noteLocalEcho: vi.fn(), isSuppressed: () => true })(event)
    expect(event.defaultPrevented).toBe(true)
    expect(term.paste).not.toHaveBeenCalled()
  })

  it('leaves an image paste to the WebView when path insertion is off', () => {
    const term = makeTerm()
    const event = pasteEvent({ items: [{ type: 'image/png', getAsFile: () => null }] })
    createNativePasteGate({ term, noteLocalEcho: vi.fn(), isSuppressed: () => false, canInsertImagePaths: () => false })(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('stores pasted files and types their paths', async () => {
    const term = makeTerm()
    const noteLocalEcho = vi.fn()
    const onFilesSaved = vi.fn()
    h.saveAttachmentFiles.mockResolvedValueOnce([{ info: { path: 'C:/a.txt' } }]).mockResolvedValueOnce([])
    const gate = createNativePasteGate({ term, noteLocalEcho, isSuppressed: () => false, onFilesSaved, sessionId: 's' })
    const event = pasteEvent({ files: [new File(['x'], 'a.txt')] })
    gate(event)
    await flush()
    expect(event.defaultPrevented).toBe(true)
    expect(h.saveAttachmentFiles).toHaveBeenCalledWith(expect.any(Array), 's')
    expect(term.paste).toHaveBeenCalledWith('C:/a.txt')
    expect(onFilesSaved).toHaveBeenCalledOnce()
    gate(pasteEvent({ files: [new File(['x'], 'b.txt')] }))
    await flush()
    expect(term.paste).toHaveBeenCalledTimes(1)
  })

  it('treats files as plain paste input when path insertion is off', () => {
    const term = makeTerm()
    const event = pasteEvent({ files: [new File(['x'], 'a.txt')], text: 'typed' })
    createNativePasteGate({ term, noteLocalEcho: vi.fn(), isSuppressed: () => false, canInsertImagePaths: () => false })(event)
    expect(term.paste).toHaveBeenCalledWith('typed')
    expect(h.saveAttachmentFiles).not.toHaveBeenCalled()
  })

  it('saves a pasted image and types its path', async () => {
    const term = makeTerm()
    const clipboard = api()
    const onImageSaved = vi.fn()
    const file = { arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2]).buffer) }
    const gate = createNativePasteGate({ term, noteLocalEcho: vi.fn(), isSuppressed: () => false, onImageSaved, sessionId: 's' })
    gate(pasteEvent({ items: [{ type: 'image/png', getAsFile: () => file }] }))
    await flush()
    expect(clipboard.saveImageTemp).toHaveBeenCalledWith(new Uint8Array([1, 2]), 's')
    expect(onImageSaved).toHaveBeenCalledWith({ bytes: new Uint8Array([1, 2]), path: 'C:/tmp/a.png' })
    expect(term.paste).toHaveBeenCalledWith('C:/tmp/a.png')
    clipboard.saveImageTemp.mockResolvedValueOnce('')
    gate(pasteEvent({ items: [{ type: 'image/png', getAsFile: () => file }] }))
    await flush()
    expect(term.paste).toHaveBeenCalledTimes(1)
    gate(pasteEvent({ items: [{ type: 'image/png', getAsFile: () => null }] }))
  })

  it('pastes plain text, hands a large one to the large-paste flow, and ignores an empty one', () => {
    const term = makeTerm()
    const noteLocalEcho = vi.fn()
    const gate = createNativePasteGate({ term, noteLocalEcho, isSuppressed: () => false })
    gate(pasteEvent({ text: 'small' }))
    expect(term.paste).toHaveBeenCalledWith('small')
    expect(noteLocalEcho).toHaveBeenCalledOnce()
    gate(pasteEvent({ text: 'x'.repeat(1000) }))
    expect(h.handleLargeTextPaste).toHaveBeenCalledOnce()
    const empty = pasteEvent({ text: '' })
    gate(empty)
    expect(empty.defaultPrevented).toBe(true)
    expect(term.paste).toHaveBeenCalledTimes(1)
    const bare = new Event('paste', { cancelable: true }) as ClipboardEvent
    gate(bare)
  })

  it('pastes a large text directly when path insertion is off', () => {
    const term = makeTerm()
    createNativePasteGate({ term, noteLocalEcho: vi.fn(), isSuppressed: () => false, canInsertImagePaths: () => false })(
      pasteEvent({ text: 'y'.repeat(2000) }),
    )
    expect(h.handleLargeTextPaste).not.toHaveBeenCalled()
    expect(term.paste).toHaveBeenCalledOnce()
  })
})

describe('createTerminalClipboard branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.promptChars = 1000
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  })
  afterEach(() => vi.useRealTimers())

  it('writes through the browser clipboard when the bridge fails, and tolerates its absence', async () => {
    api({ writeText: vi.fn().mockRejectedValue(new Error('x')) })
    await expect(writeClipboardText('t')).resolves.toBeUndefined()
  })

  it('ignores overlapping pastes and an empty selection', async () => {
    const clipboard = api({ readText: vi.fn().mockResolvedValue('text') })
    const term = makeTerm()
    const board = createTerminalClipboard(term)
    const first = board.paste()
    await board.paste()
    await first
    expect(term.paste).toHaveBeenCalledTimes(1)
    expect(clipboard.readText).toHaveBeenCalledTimes(1)
    await board.copySelection()
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('hands a large text to the large-paste flow with the pane options', async () => {
    api({ readText: vi.fn().mockResolvedValue('z'.repeat(1500)) })
    const term = makeTerm()
    const onBeforePaste = vi.fn()
    await createTerminalClipboard(term, onBeforePaste, () => false, undefined, undefined, 'sid').paste()
    const args = h.handleLargeTextPaste.mock.calls[0]![0] as { noteLocalEcho: () => void; canInsertImagePaths: boolean; sessionId: string }
    args.noteLocalEcho()
    expect(onBeforePaste).toHaveBeenCalledOnce()
    expect(args).toMatchObject({ canInsertImagePaths: false, sessionId: 'sid' })
  })

  it('stays inert for an empty clipboard when image paths are off, and types imported files otherwise', async () => {
    api()
    const term = makeTerm()
    await createTerminalClipboard(term, undefined, () => false).paste()
    expect(term.paste).not.toHaveBeenCalled()
    window.omnitermAPI = {
      ...window.omnitermAPI,
      attachments: { importClipboardFiles: vi.fn().mockResolvedValue([{ path: 'C:/f.txt' }]) },
    } as never
    const onFilesSaved = vi.fn()
    await createTerminalClipboard(term, undefined, () => true, undefined, onFilesSaved).paste()
    expect(term.paste).toHaveBeenCalledWith('C:/f.txt')
    expect(onFilesSaved).toHaveBeenCalledOnce()
  })

  it('survives a failing import and a missing attachments bridge', async () => {
    api()
    const term = makeTerm()
    window.omnitermAPI = {
      ...window.omnitermAPI,
      attachments: { importClipboardFiles: vi.fn().mockRejectedValue(new Error('x')) },
    } as never
    await createTerminalClipboard(term).paste()
    window.omnitermAPI = { ...window.omnitermAPI, attachments: undefined } as never
    await createTerminalClipboard(term).paste()
    expect(term.paste).not.toHaveBeenCalled()
  })

  it('reads an image from the web clipboard, skipping non-image items and failed saves', async () => {
    const clipboard = api({ saveImageTemp: vi.fn().mockResolvedValueOnce('').mockResolvedValue('C:/p.png') })
    const png = { types: ['image/png'], getType: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }) }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [{ types: ['text/plain'], getType: vi.fn() }, png, png] },
    })
    const term = makeTerm()
    const onImageSaved = vi.fn()
    await createTerminalClipboard(term, undefined, () => true, onImageSaved).pasteImage()
    expect(clipboard.saveImageTemp).toHaveBeenCalledTimes(2)
    expect(onImageSaved).toHaveBeenCalledWith({ bytes: new Uint8Array([1]), path: 'C:/p.png' })
    expect(term.paste).toHaveBeenCalledWith('C:/p.png')
  })

  it('falls back to text when pasteImage finds no image, and ignores overlap', async () => {
    api({ readText: vi.fn().mockResolvedValue('fallback') })
    const term = makeTerm()
    const board = createTerminalClipboard(term)
    const first = board.pasteImage()
    await board.pasteImage()
    await first
    expect(term.paste).toHaveBeenCalledWith('fallback')
    expect(term.paste).toHaveBeenCalledTimes(1)
    api({ readText: vi.fn().mockRejectedValue(new Error('denied')) })
    const other = makeTerm()
    await createTerminalClipboard(other).pasteImage()
    expect(other.paste).not.toHaveBeenCalled()
  })

  it('encodes native RGBA pixels as a PNG and rejects malformed ones', async () => {
    const toBlob = vi.fn((cb: (blob: Blob | null) => void) => cb(new Blob([new Uint8Array([9])], { type: 'image/png' })))
    const context = { createImageData: (w: number, h2: number) => ({ data: new Uint8ClampedArray(w * h2 * 4) }), putImageData: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob as never)
    const rgba = new Uint8Array(2 * 2 * 4)
    const clipboard = api({ readImage: vi.fn().mockResolvedValue({ rgba, width: 2, height: 2 }) })
    const term = makeTerm()
    await createTerminalClipboard(term).pasteImage()
    expect(term.paste).toHaveBeenCalledWith('C:/tmp/a.png')
    expect(clipboard.saveImageTemp.mock.calls[0]![0]).toEqual(new Uint8Array([9]))

    for (const bad of [{ rgba, width: 0, height: 2 }, { rgba: new Uint8Array(3), width: 2, height: 2 }]) {
      const quiet = makeTerm()
      api({ readImage: vi.fn().mockResolvedValue(bad) })
      await createTerminalClipboard(quiet).pasteImage()
      expect(quiet.paste).not.toHaveBeenCalled()
    }

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    api({ readImage: vi.fn().mockResolvedValue({ rgba, width: 2, height: 2 }) })
    const noContext = makeTerm()
    await createTerminalClipboard(noContext).pasteImage()
    expect(noContext.paste).not.toHaveBeenCalled()

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((cb: (blob: Blob | null) => void) => cb(null)) as never)
    const noBlob = makeTerm()
    await createTerminalClipboard(noBlob).pasteImage()
    expect(noBlob.paste).not.toHaveBeenCalled()

    context.putImageData.mockImplementation(() => { throw new Error('canvas') })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob as never)
    const broken = makeTerm()
    await createTerminalClipboard(broken).pasteImage()
    expect(broken.paste).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('pastes a script as a PowerShell block, replacing the previous marker', async () => {
    const dispose = vi.fn()
    h.markPastedScript.mockReturnValue({ dispose })
    h.formatScript.mockReturnValue('{block}')
    api({ readText: vi.fn().mockResolvedValue('Get-Item') })
    const term = makeTerm()
    const onBeforePaste = vi.fn()
    const board = createTerminalClipboard(term, onBeforePaste)
    await board.pasteScript(true)
    await board.pasteScript(true)
    expect(term.paste).toHaveBeenLastCalledWith('{block}')
    expect(dispose).toHaveBeenCalledTimes(1)
    h.formatScript.mockReturnValue('')
    await board.pasteScript(true)
    expect(term.paste).toHaveBeenCalledTimes(2)
    await board.pasteScript(false)
    expect(term.paste).toHaveBeenLastCalledWith('Get-Item')
    board.dispose()
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('reads the script from the browser clipboard when the bridge has none', async () => {
    api({ readText: vi.fn().mockRejectedValue(new Error('x')) })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn().mockResolvedValue('web text') } })
    const term = makeTerm()
    const board = createTerminalClipboard(term)
    await board.pasteScript(false)
    expect(term.paste).toHaveBeenCalledWith('web text')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn().mockRejectedValue(new Error('x')) } })
    await board.pasteScript(false)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    await board.pasteScript(false)
    expect(term.paste).toHaveBeenCalledTimes(1)
    const overlap = board.pasteScript(false)
    await board.pasteScript(false)
    await overlap
  })

  it('stores files only when path insertion is on, and manages the drop target', async () => {
    api()
    h.saveAttachmentFiles.mockResolvedValue([{ info: { path: 'C:/d.txt' } }])
    h.installAttachmentDrop.mockReturnValue(h.dropDispose)
    const term = makeTerm()
    const off = createTerminalClipboard(term, undefined, () => false)
    await off.pasteFiles([new File(['x'], 'd.txt')])
    expect(term.paste).not.toHaveBeenCalled()
    const on = createTerminalClipboard(term)
    await on.pasteFiles([new File(['x'], 'd.txt')])
    expect(term.paste).toHaveBeenCalledWith('C:/d.txt')
    const element = document.createElement('div')
    on.installDrop(element)
    on.installDrop(element)
    expect(h.dropDispose).toHaveBeenCalledTimes(1)
    const onDrop = h.installAttachmentDrop.mock.calls[0]![2] as (files: File[]) => void
    onDrop([new File(['x'], 'e.txt')])
    on.dispose()
    expect(h.dropDispose).toHaveBeenCalledTimes(2)
  })

  it('debounces auto-copy of a selection', async () => {
    vi.useFakeTimers()
    const clipboard = api()
    let notify: () => void = () => {}
    const term = {
      paste: vi.fn(),
      getSelection: vi.fn().mockReturnValue('picked'),
      onSelectionChange: (cb: () => void) => { notify = cb; return { dispose: vi.fn() } },
    } as unknown as Terminal
    const board = createTerminalClipboard(term)
    notify()
    notify()
    await vi.advanceTimersByTimeAsync(100)
    expect(clipboard.writeText).toHaveBeenCalledTimes(1)
    ;(term.getSelection as ReturnType<typeof vi.fn>).mockReturnValue('')
    notify()
    await vi.advanceTimersByTimeAsync(100)
    expect(clipboard.writeText).toHaveBeenCalledTimes(1)
    board.dispose()
  })
})
