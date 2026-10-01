/**
 * @vitest-environment jsdom
 */
import type { Terminal } from '@xterm/xterm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AttachmentInfo } from '../attachmentTypes'
import { resolveLargeTextPaste, subscribeLargeTextPaste } from '../largeTextPasteStore'
import { createNativePasteGate, createTerminalClipboard } from '../terminalClipboard'

const info = (name: string): AttachmentInfo => ({
  name,
  path: `C:/data/attachments/${name}`,
  size: 100,
  modifiedMs: 1,
  kind: 'file',
})

const save = vi.fn(async (name: string) => info(name.replace('.', '-1.')))

const term = () => ({
  onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
  paste: vi.fn(),
  focus: vi.fn(),
}) as unknown as Terminal & { paste: ReturnType<typeof vi.fn> }

describe('large text paste handling through terminal clipboard', () => {
  beforeEach(() => {
    save.mockClear()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} })
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: {
        writeText: vi.fn(),
        readText: async () => '',
        readImage: async () => null,
        saveImageTemp: vi.fn(),
      },
      attachments: { save, importClipboardFiles: vi.fn(async () => []), list: vi.fn(), clear: vi.fn() },
    }
  })

  it('automatically attaches large text (> 3,000 chars) on an agent pane via clipboard.paste()', async () => {
    const hugeText = 'z'.repeat(3500)
    window.omnitermAPI.clipboard.readText = async () => hugeText

    const onFilesSaved = vi.fn()
    const target = term()
    const clipboard = createTerminalClipboard(target, vi.fn(), () => true, undefined, onFilesSaved, 'sess-agent')

    await clipboard.paste()

    expect(save).toHaveBeenCalledWith('pasted-text.txt', expect.anything(), 'sess-agent')
    expect(target.paste).toHaveBeenCalledWith('C:/data/attachments/pasted-text-1.txt')
    expect(onFilesSaved).toHaveBeenCalledWith([{ info: info('pasted-text-1.txt') }])
    clipboard.dispose()
  })

  it('pastes raw text even when > 3,000 chars if the pane is not an agent', async () => {
    const hugeText = 'z'.repeat(3500)
    window.omnitermAPI.clipboard.readText = async () => hugeText

    const onFilesSaved = vi.fn()
    const target = term()
    const clipboard = createTerminalClipboard(target, vi.fn(), () => false, undefined, onFilesSaved, 'sess-shell')

    await clipboard.paste()

    expect(save).not.toHaveBeenCalled()
    expect(target.paste).toHaveBeenCalledWith(hugeText)
    expect(onFilesSaved).not.toHaveBeenCalled()
    clipboard.dispose()
  })

  it('automatically attaches large text (> 3,000 chars) on an agent pane via native paste gate', async () => {
    const hugeText = '{\n  "large": "' + 'x'.repeat(3200) + '"\n}'
    const target = term()
    const onFilesSaved = vi.fn()
    const noteLocalEcho = vi.fn()

    const event = {
      clipboardData: { items: [], files: [], getData: () => hugeText },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as ClipboardEvent

    const gate = createNativePasteGate({
      term: target,
      noteLocalEcho,
      isSuppressed: () => false,
      canInsertImagePaths: () => true,
      onFilesSaved,
      sessionId: 'sess-agent-native',
    })

    gate(event)

    expect(event.preventDefault).toHaveBeenCalled()
    await vi.waitFor(() => expect(target.paste).toHaveBeenCalledWith('C:/data/attachments/pasted-data-1.json'))
    expect(save).toHaveBeenCalledWith('pasted-data.json', expect.anything(), 'sess-agent-native')
    expect(onFilesSaved).toHaveBeenCalledOnce()
    expect(noteLocalEcho).toHaveBeenCalledOnce()
  })

  it('prompts user for 1,000–3,000 chars and resolves choice', async () => {
    const mediumText = '# Instructions\n' + 'y'.repeat(1200)
    const target = term()
    const onFilesSaved = vi.fn()
    const noteLocalEcho = vi.fn()

    // Subscribe to large text paste requests
    const unsubscribe = subscribeLargeTextPaste(() => {
      // Simulate user clicking "Attach as Document"
      resolveLargeTextPaste('attach')
    })

    const event = {
      clipboardData: { items: [], files: [], getData: () => mediumText },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as ClipboardEvent

    const gate = createNativePasteGate({
      term: target,
      noteLocalEcho,
      isSuppressed: () => false,
      canInsertImagePaths: () => true,
      onFilesSaved,
      sessionId: 'sess-prompt-test',
    })

    gate(event)

    await vi.waitFor(() => expect(target.paste).toHaveBeenCalledWith('C:/data/attachments/pasted-document-1.md'))
    expect(save).toHaveBeenCalledWith('pasted-document.md', expect.anything(), 'sess-prompt-test')
    expect(onFilesSaved).toHaveBeenCalledOnce()

    unsubscribe()
  })
})
