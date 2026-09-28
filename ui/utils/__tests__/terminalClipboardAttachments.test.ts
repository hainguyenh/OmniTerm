/**
 * @vitest-environment jsdom
 */
import type { Terminal } from '@xterm/xterm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AttachmentInfo } from '../attachmentTypes'
import { createNativePasteGate, createTerminalClipboard } from '../terminalClipboard'

const info = (name: string, kind: AttachmentInfo['kind'] = 'file'): AttachmentInfo =>
  ({ name, path: `C:/data/attachments/${name}`, size: 4, modifiedMs: 1, kind })

const save = vi.fn(async (name: string) => info(name.replace('.', '-9.')))
const importClipboardFiles = vi.fn(async (): Promise<AttachmentInfo[]> => [])

const term = () => ({
  onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
  paste: vi.fn(),
}) as unknown as Terminal & { paste: ReturnType<typeof vi.fn> }

beforeEach(() => {
  save.mockClear()
  importClipboardFiles.mockReset().mockResolvedValue([])
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} })
  window.omnitermAPI = {
    ...window.omnitermAPI,
    clipboard: { writeText: vi.fn(), readText: async () => '', readImage: async () => null, saveImageTemp: vi.fn() },
    attachments: { save, importClipboardFiles, list: vi.fn(), clear: vi.fn() },
  }
})

const file = (name: string, type = 'application/pdf') => new File([new Uint8Array([1, 2, 3, 4])], name, { type })

describe('file attachments through the terminal clipboard', () => {
  it('stores files copied in Explorer and types their stored paths (Ctrl+V with no text or image)', async () => {
    importClipboardFiles.mockResolvedValue([info('report-1.pdf'), info('my notes-1.txt')])
    const onFilesSaved = vi.fn()
    const target = term()
    const clipboard = createTerminalClipboard(target, vi.fn(), () => true, undefined, onFilesSaved)

    await clipboard.paste()

    expect(target.paste).toHaveBeenCalledWith('C:/data/attachments/report-1.pdf "C:/data/attachments/my notes-1.txt"')
    expect(onFilesSaved).toHaveBeenCalledWith([{ info: info('report-1.pdf') }, { info: info('my notes-1.txt') }])
    clipboard.dispose()
  })

  it('never imports clipboard files into a pane that is not an agent', async () => {
    const target = term()
    const clipboard = createTerminalClipboard(target, vi.fn(), () => false)
    await clipboard.paste()
    await clipboard.pasteFiles([file('a.pdf')])
    expect(importClipboardFiles).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(target.paste).not.toHaveBeenCalled()
    clipboard.dispose()
  })

  it('stores dropped files, keeping image bytes for the viewer', async () => {
    save.mockImplementation(async (name: string) => info(name.replace('.', '-9.'), name.endsWith('.png') ? 'image' : 'file'))
    const onFilesSaved = vi.fn()
    const target = term()
    const clipboard = createTerminalClipboard(target, vi.fn(), () => true, undefined, onFilesSaved)

    await clipboard.pasteFiles([file('shot.png', 'image/png'), file('spec.pdf'), new File([], 'empty.txt')])

    expect(save).toHaveBeenCalledTimes(2)
    expect(target.paste).toHaveBeenCalledWith('C:/data/attachments/shot-9.png C:/data/attachments/spec-9.pdf')
    const [saved] = onFilesSaved.mock.calls[0]
    expect(saved[0].bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(saved[1].bytes).toBeUndefined()
    clipboard.dispose()
  })

  it('accepts a file drop on an agent pane only, and detaches on dispose', async () => {
    let agent = true
    const target = term()
    const clipboard = createTerminalClipboard(target, vi.fn(), () => agent)
    const element = document.createElement('div')
    clipboard.installDrop(element)

    const drop = (types: string[]) => {
      const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
      Object.defineProperty(event, 'dataTransfer', { value: { types, files: [file('a.pdf')] } })
      element.dispatchEvent(event)
      return event
    }

    expect(drop(['text/plain']).defaultPrevented).toBe(false) // a pane-rearrange drag passes through
    expect(drop(['Files']).defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(target.paste).toHaveBeenCalledWith('C:/data/attachments/a-9.pdf'))

    agent = false
    expect(drop(['Files']).defaultPrevented).toBe(false)
    agent = true
    clipboard.dispose()
    expect(drop(['Files']).defaultPrevented).toBe(false)
  })

  it('stores non-image files from a native paste event on an agent pane', async () => {
    const target = term()
    const onFilesSaved = vi.fn()
    const noteLocalEcho = vi.fn()
    const event = {
      clipboardData: { items: [], files: [file('brief.pdf')], getData: () => '' },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as ClipboardEvent
    const gate = createNativePasteGate({ term: target, noteLocalEcho, isSuppressed: () => false, onFilesSaved })

    gate(event)

    expect(event.preventDefault).toHaveBeenCalled()
    await vi.waitFor(() => expect(target.paste).toHaveBeenCalledWith('C:/data/attachments/brief-9.pdf'))
    expect(onFilesSaved).toHaveBeenCalledOnce()
    expect(noteLocalEcho).toHaveBeenCalledOnce()
  })
})
