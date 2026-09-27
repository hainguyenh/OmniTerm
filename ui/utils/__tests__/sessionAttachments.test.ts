/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatAttachmentPaths, MAX_ATTACHMENT_BYTES, saveAttachmentFiles } from '../attachmentInput'
import { canOpenAttachment, formatBytes, parseAttachmentListing, parseClearReport } from '../attachmentTypes'
import { getPastedImages } from '../pastedImageStore'
import {
  getSessionAttachments,
  MAX_SESSION_ATTACHMENTS,
  recordPastedImage,
  recordSavedAttachments,
  releaseSessionMedia,
  subscribeSessionAttachments,
} from '../sessionAttachmentStore'

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  releaseSessionMedia('s1')
  vi.restoreAllMocks()
})

describe('attachment IPC validation', () => {
  it('drops malformed rows instead of trusting them', () => {
    const listing = parseAttachmentListing({
      dir: 'C:/data/attachments',
      files: [
        { name: 'a.png', path: 'C:/data/attachments/a.png', size: 3, modifiedMs: 5, kind: 'image' },
        { name: 'b', path: '', size: 3, modifiedMs: 5, kind: 'file' },
        { name: 'c', path: 'C:/c', size: -1, modifiedMs: 5, kind: 'file' },
        { name: 'd', path: 'C:/d', size: 1, modifiedMs: 5, kind: 'exe' },
        'nope',
      ],
    })
    expect(listing.dir).toBe('C:/data/attachments')
    expect(listing.files.map((file) => file.name)).toEqual(['a.png'])
    expect(parseAttachmentListing(null)).toEqual({ dir: '', files: [] })
    expect(parseClearReport({ removed: 2, bytes: 'x' })).toEqual({ removed: 2, bytes: 0, failed: 0 })
  })

  it('formats sizes and only opens document and image types', () => {
    expect(formatBytes(90)).toBe('90 B')
    expect(formatBytes(812 * 1024)).toBe('812 KB')
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2.4 MB')
    expect(canOpenAttachment('report.PDF')).toBe(true)
    expect(canOpenAttachment('shot.png')).toBe(true)
    for (const name of ['setup.exe', 'run.cmd', 'x.ps1', 'link.lnk', 'noext', '.pdf']) expect(canOpenAttachment(name)).toBe(false)
  })
})

describe('attachment input', () => {
  it('quotes only the paths that contain whitespace', () => {
    expect(formatAttachmentPaths(['C:/a/x.png', 'C:/my files/y.pdf'])).toBe('C:/a/x.png "C:/my files/y.pdf"')
  })

  it('skips empty, oversized and refused files but keeps the rest', async () => {
    const save = vi.fn(async (name: string) => {
      if (name === 'refused.txt') throw new Error('disk full')
      return { name, path: `C:/a/${name}`, size: 1, modifiedMs: 1, kind: 'file' as const }
    })
    window.omnitermAPI = { ...window.omnitermAPI, attachments: { save, importClipboardFiles: vi.fn(), list: vi.fn(), clear: vi.fn() } }
    const huge = new File(['x'], 'huge.bin')
    Object.defineProperty(huge, 'size', { value: MAX_ATTACHMENT_BYTES + 1 })
    const saved = await saveAttachmentFiles([new File(['ok'], 'ok.txt'), new File([], 'empty.txt'), huge, new File(['r'], 'refused.txt')])
    expect(saved.map(({ info }) => info.name)).toEqual(['ok.txt'])
    expect(save).toHaveBeenCalledTimes(2)
  })
})

describe('session attachment store', () => {
  it('records pasted images in both the viewer history and the attachment list', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSessionAttachments('s1', listener)
    recordPastedImage('s1', { bytes: new Uint8Array([1, 2]), path: 'C:\\data\\attachments\\paste-1.png' }, 10)
    expect(getSessionAttachments('s1')).toEqual([{ path: 'C:\\data\\attachments\\paste-1.png', name: 'paste-1.png', kind: 'image', size: 2, at: 10 }])
    expect(getPastedImages('s1')).toHaveLength(1)
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('dedupes by path, caps the list, and forgets it on release', () => {
    const entry = (index: number) => ({ info: { name: `f${index}.txt`, path: `C:/a/f${index}.txt`, size: 1, modifiedMs: 1, kind: 'file' as const } })
    recordSavedAttachments('s1', [entry(1), entry(1)])
    expect(getSessionAttachments('s1')).toHaveLength(1)
    recordSavedAttachments('s1', Array.from({ length: MAX_SESSION_ATTACHMENTS + 5 }, (_, index) => entry(index + 2)))
    expect(getSessionAttachments('s1')).toHaveLength(MAX_SESSION_ATTACHMENTS)
    expect(getSessionAttachments('s1')[0].name).toBe('f7.txt')
    releaseSessionMedia('s1')
    expect(getSessionAttachments('s1')).toEqual([])
    expect(getSessionAttachments(null)).toEqual([])
  })

  it('sends dropped images with bytes to the viewer too', () => {
    recordSavedAttachments('s1', [{ info: { name: 'd.png', path: 'C:/a/d.png', size: 2, modifiedMs: 1, kind: 'image' }, bytes: new Uint8Array([1, 2]) }])
    expect(getPastedImages('s1').map((image) => image.path)).toEqual(['C:/a/d.png'])
  })
})
