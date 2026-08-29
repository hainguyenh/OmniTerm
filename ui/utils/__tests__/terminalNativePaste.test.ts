/**
 * @vitest-environment jsdom
 */
import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'

import { createNativePasteGate } from '../terminalClipboard'

interface NativePasteItem {
  type: string
  getAsFile: () => Blob | null
}

const pasteEvent = (items: NativePasteItem[] = [], text = '') => ({
  clipboardData: {
    items,
    getData: vi.fn((type: string) => type === 'text/plain' ? text : ''),
  },
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  stopImmediatePropagation: vi.fn(),
}) as unknown as ClipboardEvent

describe('native terminal paste gate', () => {
  it('pastes text delivered by a clipboard-history event exactly once', () => {
    const term = { paste: vi.fn() } as unknown as Terminal
    const noteLocalEcho = vi.fn()
    const event = pasteEvent([], 'from clipboard history')
    const gate = createNativePasteGate({
      term,
      noteLocalEcho,
      isSuppressed: () => false,
    })

    gate(event)

    expect(term.paste).toHaveBeenCalledOnce()
    expect(term.paste).toHaveBeenCalledWith('from clipboard history')
    expect(noteLocalEcho).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()
  })

  it('cancels a suppressed native paste without writing it again', () => {
    const term = { paste: vi.fn() } as unknown as Terminal
    const event = pasteEvent([], 'duplicate native paste')
    const gate = createNativePasteGate({
      term,
      noteLocalEcho: vi.fn(),
      isSuppressed: () => true,
    })

    gate(event)

    expect(term.paste).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()
  })

  it('reports saved bytes and path through onImageSaved', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71])
    const imageItem = { type: 'image/png', getAsFile: () => new Blob([pngBytes], { type: 'image/png' }) }
    const event = pasteEvent([imageItem])
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
})
