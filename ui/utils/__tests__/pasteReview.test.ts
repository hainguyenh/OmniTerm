/**
 * @vitest-environment jsdom
 */
import type { Terminal } from '@xterm/xterm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AttachmentInfo } from '../attachmentTypes'
import type { SavedAttachment } from '../attachmentInput'
import { forgetPasteReview, isWorthReview, keepPasteForReview } from '../pasteReview'
import { createNativePasteGate, createTerminalClipboard } from '../terminalClipboard'

const info = (name: string): AttachmentInfo => ({
  name,
  path: `C:/data/attachments/${name}`,
  size: 100,
  modifiedMs: 1,
  kind: 'file',
})

const PROMPT = 'Review the change in src/app.ts and list what the new guard blocks, one line per case.'

describe('keepPasteForReview', () => {
  beforeEach(() => forgetPasteReview('pane'))

  it('keeps a multi-line or long paste, not a word', () => {
    expect(isWorthReview('main')).toBe(false)
    expect(isWorthReview('git status\ngit diff')).toBe(true)
    expect(isWorthReview(PROMPT)).toBe(true)
  })

  it('stores a paste once per pane and offers the same copy again', async () => {
    let n = 0
    const save = vi.fn(async (): Promise<SavedAttachment> => ({ info: info(`pasted-text-${++n}.txt`) }))
    const onSaved = vi.fn()

    await keepPasteForReview(PROMPT, 'pane', save, onSaved)
    await keepPasteForReview(PROMPT, 'pane', save, onSaved)

    expect(save).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenNthCalledWith(2, [{ info: info('pasted-text-1.txt') }])
  })

  it('does nothing without a pane, a listener, or a stored file', async () => {
    const save = vi.fn(async () => null)
    const onSaved = vi.fn()
    await keepPasteForReview(PROMPT, undefined, save, onSaved)
    await keepPasteForReview(PROMPT, 'pane', save, undefined)
    expect(save).not.toHaveBeenCalled()
    await keepPasteForReview(PROMPT, 'pane', save, onSaved)
    expect(onSaved).not.toHaveBeenCalled()
  })
})

// Regression: text pasted into an agent pane was not kept anywhere to review later.
describe('a paste into an agent pane lands on its attachment list', () => {
  const save = vi.fn(async (name: string) => info(name))
  const term = () => ({
    onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
    paste: vi.fn(),
    focus: vi.fn(),
  }) as unknown as Terminal & { paste: ReturnType<typeof vi.fn> }
  const pasteEvent = (text: string) => ({
    clipboardData: { items: [], files: [], getData: () => text },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  }) as unknown as ClipboardEvent

  beforeEach(() => {
    save.mockClear()
    forgetPasteReview('agent')
    forgetPasteReview('shell')
    window.omnitermAPI = {
      ...window.omnitermAPI,
      clipboard: { writeText: vi.fn(), readText: async () => PROMPT, readImage: async () => null, saveImageTemp: vi.fn() },
      attachments: { save, importClipboardFiles: vi.fn(async () => []), list: vi.fn(), clear: vi.fn() },
    }
  })

  it('still pastes the text into the prompt and records a copy (native paste)', async () => {
    const target = term()
    const onFilesSaved = vi.fn()
    const gate = createNativePasteGate({
      term: target, noteLocalEcho: vi.fn(), isSuppressed: () => false,
      canInsertImagePaths: () => true, onFilesSaved, sessionId: 'agent',
    })

    gate(pasteEvent(PROMPT))

    expect(target.paste).toHaveBeenCalledWith(PROMPT)
    await vi.waitFor(() => expect(onFilesSaved).toHaveBeenCalledWith([{ info: info('pasted-text.txt') }]))
    expect(save).toHaveBeenCalledWith('pasted-text.txt', expect.anything(), 'agent')
  })

  it('records a copy for Ctrl+V through the app clipboard too', async () => {
    const target = term()
    const onFilesSaved = vi.fn()
    const clipboard = createTerminalClipboard(target, vi.fn(), () => true, undefined, onFilesSaved, 'agent')

    await clipboard.paste()

    expect(target.paste).toHaveBeenCalledWith(PROMPT)
    await vi.waitFor(() => expect(onFilesSaved).toHaveBeenCalledTimes(1))
    clipboard.dispose()
  })

  it('keeps nothing from a plain shell pane', async () => {
    const onFilesSaved = vi.fn()
    const clipboard = createTerminalClipboard(term(), vi.fn(), () => false, undefined, onFilesSaved, 'shell')

    await clipboard.paste()

    expect(save).not.toHaveBeenCalled()
    expect(onFilesSaved).not.toHaveBeenCalled()
    clipboard.dispose()
  })
})
