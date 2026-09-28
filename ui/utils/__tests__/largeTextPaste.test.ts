/**
 * @vitest-environment jsdom
 */
import type { Terminal } from '@xterm/xterm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AttachmentInfo } from '../attachmentTypes'
import {
  countLines,
  createTextPreview,
  detectTextAttachmentName,
  handleLargeTextPaste,
  LARGE_TEXT_FORCE_THRESHOLD,
  LARGE_TEXT_PROMPT_THRESHOLD,
  saveTextAsAttachment,
} from '../largeTextPaste'

const mockInfo = (name: string): AttachmentInfo => ({
  name,
  path: `C:/attachments/${name}`,
  size: 100,
  modifiedMs: Date.now(),
  kind: 'file',
})

describe('largeTextPaste helpers', () => {
  it('counts lines across empty strings, LF, and CRLF', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('single line')).toBe(1)
    expect(countLines('line 1\nline 2')).toBe(2)
    expect(countLines('line 1\r\nline 2\r\nline 3')).toBe(3)
  })

  it('creates trimmed previews truncated at maxLength', () => {
    expect(createTextPreview('   hello world   ')).toBe('hello world')
    const long = 'a'.repeat(300)
    const preview = createTextPreview(long, 50)
    expect(preview).toHaveLength(51) // 50 chars + ellipsis
    expect(preview.endsWith('…')).toBe(true)
  })

  it('detects json, markdown, and plain text formats for attachment name', () => {
    expect(detectTextAttachmentName('{"name": "test", "active": true}')).toBe('pasted-data.json')
    expect(detectTextAttachmentName('[1, 2, 3]')).toBe('pasted-data.json')
    expect(detectTextAttachmentName('{ invalid json')).toBe('pasted-text.txt')

    expect(detectTextAttachmentName('# Title\nSome content')).toBe('pasted-document.md')
    expect(detectTextAttachmentName('```ts\nconst x = 1\n```')).toBe('pasted-document.md')
    expect(detectTextAttachmentName('- [ ] Todo item\n- [x] Done')).toBe('pasted-document.md')

    expect(detectTextAttachmentName('Just an ordinary paragraph without any markdown.')).toBe('pasted-text.txt')
  })
})

describe('saveTextAsAttachment', () => {
  beforeEach(() => {
    window.omnitermAPI = {
      ...window.omnitermAPI,
      attachments: {
        save: vi.fn(async (nameHint: string) => mockInfo(nameHint)),
        list: vi.fn(),
        clear: vi.fn(),
        importClipboardFiles: vi.fn(),
      },
    }
  })

  it('encodes and saves text using the attachments API', async () => {
    const saved = await saveTextAsAttachment('# Heading\nText')
    expect(saved).not.toBeNull()
    expect(saved?.info.name).toBe('pasted-document.md')
    expect(window.omnitermAPI.attachments.save).toHaveBeenCalledWith(
      'pasted-document.md',
      expect.anything(),
    )
  })

  it('returns null when saving fails', async () => {
    vi.mocked(window.omnitermAPI.attachments.save).mockRejectedValueOnce(new Error('Disk error'))
    const saved = await saveTextAsAttachment('hello')
    expect(saved).toBeNull()
  })
})

describe('handleLargeTextPaste', () => {
  const term = () => ({
    paste: vi.fn(),
  }) as unknown as Terminal & { paste: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    window.omnitermAPI = {
      ...window.omnitermAPI,
      attachments: {
        save: vi.fn(async (nameHint: string) => mockInfo(nameHint)),
        list: vi.fn(),
        clear: vi.fn(),
        importClipboardFiles: vi.fn(),
      },
    }
  })

  it('pastes small text (< 1,000 chars) directly without prompting or saving', async () => {
    const target = term()
    const noteLocalEcho = vi.fn()
    const onFilesSaved = vi.fn()
    const promptDecision = vi.fn()

    const smallText = 'a'.repeat(LARGE_TEXT_PROMPT_THRESHOLD - 1)
    const handled = await handleLargeTextPaste({
      text: smallText,
      term: target,
      sessionId: 's1',
      noteLocalEcho,
      onFilesSaved,
      promptDecision,
    })

    expect(handled).toBe(true)
    expect(promptDecision).not.toHaveBeenCalled()
    expect(window.omnitermAPI.attachments.save).not.toHaveBeenCalled()
    expect(target.paste).toHaveBeenCalledWith(smallText)
    expect(noteLocalEcho).toHaveBeenCalledOnce()
    expect(onFilesSaved).not.toHaveBeenCalled()
  })

  it('forces document attachment for text > 3,000 chars without prompting', async () => {
    const target = term()
    const noteLocalEcho = vi.fn()
    const onFilesSaved = vi.fn()
    const promptDecision = vi.fn()

    const hugeText = 'b'.repeat(LARGE_TEXT_FORCE_THRESHOLD + 1)
    const handled = await handleLargeTextPaste({
      text: hugeText,
      term: target,
      sessionId: 's1',
      noteLocalEcho,
      onFilesSaved,
      promptDecision,
    })

    expect(handled).toBe(true)
    expect(promptDecision).not.toHaveBeenCalled()
    expect(window.omnitermAPI.attachments.save).toHaveBeenCalledOnce()
    expect(onFilesSaved).toHaveBeenCalledOnce()
    expect(noteLocalEcho).toHaveBeenCalledOnce()
    expect(target.paste).toHaveBeenCalledWith('C:/attachments/pasted-text.txt')
  })

  it('falls back to direct paste when saving attachment fails for > 3,000 chars', async () => {
    vi.mocked(window.omnitermAPI.attachments.save).mockRejectedValueOnce(new Error('Write failed'))
    const target = term()
    const noteLocalEcho = vi.fn()
    const onFilesSaved = vi.fn()

    const hugeText = 'c'.repeat(LARGE_TEXT_FORCE_THRESHOLD + 50)
    const handled = await handleLargeTextPaste({
      text: hugeText,
      term: target,
      sessionId: 's1',
      noteLocalEcho,
      onFilesSaved,
    })

    expect(handled).toBe(true)
    expect(target.paste).toHaveBeenCalledWith(hugeText)
    expect(noteLocalEcho).toHaveBeenCalledOnce()
    expect(onFilesSaved).not.toHaveBeenCalled()
  })

  it('prompts user for text between 1,000 and 3,000 chars and attaches when chosen', async () => {
    const target = term()
    const noteLocalEcho = vi.fn()
    const onFilesSaved = vi.fn()
    const promptDecision = vi.fn().mockResolvedValue('attach')

    const mediumText = '# Notes\n' + 'd'.repeat(1500)
    const handled = await handleLargeTextPaste({
      text: mediumText,
      term: target,
      sessionId: 's1',
      noteLocalEcho,
      onFilesSaved,
      promptDecision,
    })

    expect(handled).toBe(true)
    expect(promptDecision).toHaveBeenCalledWith('s1', mediumText, mediumText.length, 2, expect.any(String))
    expect(window.omnitermAPI.attachments.save).toHaveBeenCalledWith('pasted-document.md', expect.anything())
    expect(target.paste).toHaveBeenCalledWith('C:/attachments/pasted-document.md')
    expect(onFilesSaved).toHaveBeenCalledOnce()
  })

  it('prompts user for text between 1,000 and 3,000 chars and pastes directly when chosen', async () => {
    const target = term()
    const noteLocalEcho = vi.fn()
    const onFilesSaved = vi.fn()
    const promptDecision = vi.fn().mockResolvedValue('paste')

    const mediumText = 'e'.repeat(1500)
    const handled = await handleLargeTextPaste({
      text: mediumText,
      term: target,
      sessionId: 's1',
      noteLocalEcho,
      onFilesSaved,
      promptDecision,
    })

    expect(handled).toBe(true)
    expect(window.omnitermAPI.attachments.save).not.toHaveBeenCalled()
    expect(target.paste).toHaveBeenCalledWith(mediumText)
    expect(noteLocalEcho).toHaveBeenCalledOnce()
    expect(onFilesSaved).not.toHaveBeenCalled()
  })

  it('aborts paste when user cancels the prompt', async () => {
    const target = term()
    const noteLocalEcho = vi.fn()
    const onFilesSaved = vi.fn()
    const promptDecision = vi.fn().mockResolvedValue('cancel')

    const mediumText = 'f'.repeat(1500)
    const handled = await handleLargeTextPaste({
      text: mediumText,
      term: target,
      sessionId: 's1',
      noteLocalEcho,
      onFilesSaved,
      promptDecision,
    })

    expect(handled).toBe(false)
    expect(target.paste).not.toHaveBeenCalled()
    expect(noteLocalEcho).not.toHaveBeenCalled()
    expect(onFilesSaved).not.toHaveBeenCalled()
  })
})
