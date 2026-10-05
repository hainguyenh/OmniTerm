/**
 * @vitest-environment jsdom
 */
import { EditorView } from '@codemirror/view'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockOmnitermAPI } from '../../../testUtils'
import type { TextFileContent } from '../../../utils/textFileWire'
import { applyEffects } from '../documentModel'
import { LARGE_FILE_CHARS } from '../fileProfile'
import { loadLanguage } from '../languageLoader'
import { useTextDocument } from '../useTextDocument'
import { installCodeMirrorShims } from './cmShims'

vi.mock('../languageLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../languageLoader')>()
  return { ...actual, loadLanguage: vi.fn(async () => []) }
})

vi.mock('../documentModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../documentModel')>()
  return { ...actual, applyEffects: vi.fn(actual.applyEffects) }
})

const loadLanguageMock = vi.mocked(loadLanguage)
const applyEffectsMock = vi.mocked(applyEffects)

const file = (content: string, extra: Partial<TextFileContent> = {}): TextFileContent => ({
  content, size: content.length, mtimeMs: 1, lineCount: 1, maxLineLen: content.length, eol: 'lf',
  mixedEol: false, hasBom: false, readOnly: false, ...extra,
})

type SaveOutcome = { status: 'saved'; size: number; mtimeMs: number } | { status: 'conflict'; reason: 'modified' | 'deleted' }

interface MountOptions {
  content?: string
  fileName?: string
  visible?: boolean
  save?: () => Promise<SaveOutcome>
}

let tabCounter = 0

function mount({ content = 'abc', fileName = 'a.ts', visible = true, save }: MountOptions = {}) {
  tabCounter += 1
  const tabId = `cov2-${tabCounter}`
  const openTextFile = vi.fn(async () => file(content))
  const saveTextFile = vi.fn(save ?? (async (): Promise<SaveOutcome> => ({ status: 'saved', size: 9, mtimeMs: 5 })))
  mockOmnitermAPI({ workspace: { openTextFile, saveTextFile } })
  const hook = renderHook(({ shown }) => useTextDocument({ tabId, workspaceId: 'w', path: `p/${tabId}`, fileName, visible: shown }), {
    initialProps: { shown: visible },
  })
  return { ...hook, openTextFile, saveTextFile }
}

function attachView(result: { current: ReturnType<typeof useTextDocument> }) {
  const model = result.current.model
  if (!model.state) throw new Error('not loaded')
  const view = new EditorView({ state: model.state, parent: document.body })
  model.view = view
  return view
}

beforeAll(() => installCodeMirrorShims())

beforeEach(() => {
  loadLanguageMock.mockClear()
  applyEffectsMock.mockClear()
})

describe('useTextDocument saving', () => {
  it('reports a conflict without marking the document saved', async () => {
    const { result } = mount({ save: async () => ({ status: 'conflict', reason: 'deleted' }) })
    await waitFor(() => expect(result.current.status).toBe('ready'), { timeout: 10_000 })
    let outcome = ''
    await act(async () => { outcome = await result.current.save() })
    expect(outcome).toBe('conflict')
    expect(result.current.conflict).toBe('deleted')
    expect(result.current.saving).toBe(false)
    expect(result.current.meta?.mtimeMs).toBe(1)
  })

  it('surfaces a non-Error failure as text and lets the user dismiss it', async () => {
    const { result } = mount({ save: () => Promise.reject('disk full') })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let outcome = ''
    await act(async () => { outcome = await result.current.save() })
    expect(outcome).toBe('error')
    expect(result.current.saveError).toBe('disk full')
    act(() => { result.current.dismissSaveError() })
    expect(result.current.saveError).toBeNull()
  })

  it('treats a line-ending or BOM change as dirty and saves it with the new format', async () => {
    const { result, saveTextFile } = mount({ content: 'a\nb' })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setEol('crlf') })
    expect(result.current.dirty).toBe(true)
    act(() => { result.current.setEol('lf') })
    expect(result.current.dirty).toBe(false)
    act(() => { result.current.setBom(true) })
    expect(result.current.dirty).toBe(true)
    act(() => { result.current.setEol('crlf') })

    let outcome = ''
    await act(async () => { outcome = await result.current.save(true) })
    expect(outcome).toBe('saved')
    expect(saveTextFile).toHaveBeenCalledWith('w', expect.any(String), {
      content: 'a\r\nb', bom: true, expectedMtimeMs: 1, expectedSize: 3, force: true,
    })
    expect(result.current.dirty).toBe(false)
    expect(result.current.meta).toMatchObject({ size: 9, mtimeMs: 5, mixedEol: false, eol: 'crlf', bom: true })
  })

  it('ignores a second save while one is in flight and keeps edits made meanwhile dirty', async () => {
    let finish: (value: SaveOutcome) => void = () => {}
    const { result, saveTextFile } = mount({ save: () => new Promise((done) => { finish = done }) })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const view = attachView(result)
    act(() => { view.dispatch({ changes: { from: 3, insert: 'd' } }) })
    await waitFor(() => expect(result.current.dirty).toBe(true))

    let first: Promise<string> = Promise.resolve('')
    act(() => { first = result.current.save() })
    await waitFor(() => expect(result.current.saving).toBe(true))
    await expect(result.current.save()).resolves.toBe('noop')
    expect(saveTextFile).toHaveBeenCalledTimes(1)

    act(() => { view.dispatch({ changes: { from: 4, insert: 'e' } }) })
    await act(async () => {
      finish({ status: 'saved', size: 4, mtimeMs: 2 })
      await first
    })
    expect(result.current.dirty).toBe(true)
    view.destroy()
  })

  it('leaves format setters inert before anything is loaded', async () => {
    const { result } = mount({ visible: false })
    act(() => {
      result.current.setEol('crlf')
      result.current.setBom(true)
    })
    expect(result.current.meta).toBeNull()
    expect(result.current.dirty).toBe(false)
    expect(result.current.getText()).toBe('')
  })
})

describe('useTextDocument loading', () => {
  it('shows a non-Error open failure as the load error', async () => {
    const failing = mountFailing('denied')
    await waitFor(() => expect(failing.result.current.status).toBe('error'))
    expect(failing.result.current.loadError).toBe('denied')
  })

  it('reloads without a live state by starting from the top', async () => {
    const { result, openTextFile } = mount({ visible: false, content: 'hello' })
    await act(async () => { await result.current.reload() })
    expect(openTextFile).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('ready')
    expect(result.current.model.state?.selection.main.head).toBe(0)
  })

  it('skips the grammar for plain text and for large files', async () => {
    const plain = mount({ fileName: 'notes.txt' })
    await waitFor(() => expect(plain.result.current.status).toBe('ready'))
    const large = mount({ content: 'x'.repeat(LARGE_FILE_CHARS + 1) })
    await waitFor(() => expect(large.result.current.status).toBe('ready'))
    expect(large.result.current.meta?.profile).toBe('large')
    expect(loadLanguageMock).not.toHaveBeenCalled()
  })

  it('drops a grammar that arrives after the document was reloaded', async () => {
    let deliver: (value: never[]) => void = () => {}
    loadLanguageMock.mockImplementationOnce(() => new Promise((done) => { deliver = done }))
    const { result } = mount({ fileName: 'main.ts' })
    await waitFor(() => expect(loadLanguageMock).toHaveBeenCalledTimes(1))
    await act(async () => { await result.current.reload() })
    const applied = applyEffectsMock.mock.calls.length
    await act(async () => { deliver([]) })
    expect(applyEffectsMock.mock.calls.length).toBe(applied)
  })

  it('ignores a failed load that settles after unmount', async () => {
    let fail: (reason: unknown) => void = () => {}
    const { result, openTextFile, unmount } = mount({ visible: false })
    openTextFile.mockImplementationOnce(() => new Promise((_done, reject) => { fail = reject }))
    const pending = result.current.reload()
    unmount()
    fail(new Error('late'))
    await pending
    expect(result.current.saveError).toBeNull()
  })

  it('ignores updates from a view of an earlier load', async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const staleView = attachView(result)
    await act(async () => { await result.current.reload() })
    result.current.model.view = null
    act(() => { staleView.dispatch({ changes: { from: 0, insert: 'zzz' } }) })
    expect(result.current.dirty).toBe(false)
    expect(result.current.getText()).toBe('abc')
    staleView.destroy()
  })
})

describe('useTextDocument timers', () => {
  it('restarts the pending equality check on every equal-length edit and clears it on unmount', async () => {
    const { result, unmount } = mount()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const view = attachView(result)
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame')
    act(() => {
      view.dispatch({ changes: { from: 0, to: 1, insert: 'x' } })
      view.dispatch({ changes: { from: 0, to: 1, insert: 'y' } })
    })
    const clearedWhileTyping = clear.mock.calls.length
    expect(clearedWhileTyping).toBeGreaterThan(0)
    unmount()
    expect(clear.mock.calls.length).toBeGreaterThan(clearedWhileTyping)
    expect(cancel).toHaveBeenCalled()
    clear.mockRestore()
    cancel.mockRestore()
    view.destroy()
  })
})

function mountFailing(reason: unknown) {
  tabCounter += 1
  const tabId = `cov2-fail-${tabCounter}`
  mockOmnitermAPI({ workspace: { openTextFile: vi.fn(() => Promise.reject(reason)), saveTextFile: vi.fn() } })
  return renderHook(() => useTextDocument({ tabId, workspaceId: 'w', path: 'p', fileName: 'a.ts', visible: true }))
}
