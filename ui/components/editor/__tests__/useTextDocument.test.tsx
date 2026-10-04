/**
 * @vitest-environment jsdom
 */
import { EditorView } from '@codemirror/view'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { mockOmnitermAPI } from '../../../testUtils'
import type { TextFileContent } from '../../../utils/textFileWire'
import { STATE_BUDGET, registerDocument, updateDocument } from '../editorStateCache'
import { LARGE_FILE_CHARS } from '../fileProfile'
import { useTextDocument } from '../useTextDocument'
import { installCodeMirrorShims } from './cmShims'

const file = (content: string, extra: Partial<TextFileContent> = {}): TextFileContent => ({
  content, size: content.length, mtimeMs: 1, lineCount: 1, maxLineLen: content.length, eol: 'lf',
  mixedEol: false, hasBom: false, readOnly: false, ...extra,
})

beforeAll(() => installCodeMirrorShims())

function mount(tabId: string, content: string, visible = true) {
  const openTextFile = vi.fn(async () => file(content))
  mockOmnitermAPI({ workspace: { openTextFile, saveTextFile: vi.fn(async () => ({ status: 'saved', size: 1, mtimeMs: 2 })) } })
  const hook = renderHook(({ shown }) => useTextDocument({ tabId, workspaceId: 'w', path: `p/${tabId}`, fileName: 'a.ts', visible: shown }), {
    initialProps: { shown: visible },
  })
  return { ...hook, openTextFile }
}

function attachView(result: { current: ReturnType<typeof useTextDocument> }) {
  const model = result.current.model
  if (!model.state) throw new Error('not loaded')
  const view = new EditorView({ state: model.state, parent: document.body })
  model.view = view
  return view
}

describe('useTextDocument', () => {
  it('treats an equal-length edit undone back to the saved text as clean', async () => {
    const { result } = mount('eq', 'abc')
    // The first test pays the CodeMirror import; allow for a loaded machine.
    await waitFor(() => expect(result.current.status).toBe('ready'), { timeout: 10_000 })
    const view = attachView(result)
    act(() => { view.dispatch({ changes: { from: 0, to: 1, insert: 'x' } }) })
    await waitFor(() => expect(result.current.dirty).toBe(true))
    act(() => { view.dispatch({ changes: { from: 0, to: 1, insert: 'a' } }) })
    await waitFor(() => expect(result.current.dirty).toBe(false))
    act(() => { view.dispatch({ selection: { anchor: 1, head: 3 } }) })
    await waitFor(() => expect(result.current.cursor).toEqual({ line: 1, col: 4, selections: 1, selected: 2 }))
    view.destroy()
  })

  it('drops to the large profile when the document outgrows the limit', async () => {
    const { result } = mount('grow', 'x')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const view = attachView(result)
    act(() => { view.dispatch({ changes: { from: 1, insert: 'y'.repeat(LARGE_FILE_CHARS) } }) })
    await waitFor(() => expect(result.current.meta?.profile).toBe('large'))
    view.destroy()
  })

  it('reloads an evicted document on show, keeping the cursor', async () => {
    const { result, rerender, openTextFile } = mount('evict', 'hello world')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const view = attachView(result)
    act(() => { view.dispatch({ selection: { anchor: 5 } }) })
    view.destroy()
    result.current.model.view = null
    rerender({ shown: false })
    // Other, more recently shown documents push this one out of the budget.
    act(() => {
      for (let index = 0; index < STATE_BUDGET.maxStates + 1; index += 1) {
        registerDocument(`other${index}`, () => {})
        updateDocument(`other${index}`, { loaded: true, chars: 1, visible: true })
      }
    })
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.model.state).toBeNull()
    rerender({ shown: true })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(openTextFile).toHaveBeenCalledTimes(2)
    expect(result.current.model.state?.selection.main.head).toBe(5)
  })

  it('reports a failed reload as a save-area error and ignores replies after unmount', async () => {
    const { result, openTextFile, unmount } = mount('reload', 'abc')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    openTextFile.mockRejectedValueOnce(new Error('gone'))
    await act(async () => { await result.current.reload() })
    expect(result.current.saveError).toBe('gone')
    expect(result.current.status).toBe('ready')

    let resolve: (value: TextFileContent) => void = () => {}
    openTextFile.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const pending = result.current.reload()
    unmount()
    resolve(file('late'))
    await pending
    expect(result.current.model.state?.doc.toString()).toBe('abc')
  })

  it('reveals an offset only when a view exists and exposes the text to previews', async () => {
    const { result } = mount('reveal', 'line1\nline2')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    result.current.reveal(3)
    expect(result.current.getText()).toBe('line1\nline2')
    const view = attachView(result)
    const listener = vi.fn()
    const unsubscribe = result.current.subscribe(listener)
    act(() => { result.current.reveal(100) })
    expect(view.state.selection.main.head).toBe(11)
    act(() => { view.dispatch({ changes: { from: 0, insert: '!' } }) })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    act(() => { view.dispatch({ changes: { from: 0, insert: '!' } }) })
    expect(listener).toHaveBeenCalledTimes(1)
    view.destroy()
  })

  it('does not save before the document is loaded', async () => {
    const { result } = mount('early', 'abc', false)
    await expect(result.current.save()).resolves.toBe('noop')
  })
})
