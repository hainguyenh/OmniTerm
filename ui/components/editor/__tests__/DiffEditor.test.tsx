/**
 * @vitest-environment jsdom
 */
import { EditorView } from '@codemirror/view'
import { act, render, waitFor } from '@testing-library/react'
import { createRef, type ComponentProps } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { DiffEditor } from '../DiffEditor'
import type { TextEditorHandle } from '../diffEditorModel'
import { installCodeMirrorShims } from './cmShims'

beforeAll(installCodeMirrorShims)

const views = () => {
  const [a, b] = [...document.querySelectorAll('.cm-content')].map((dom) => EditorView.findFromDOM(dom as HTMLElement))
  if (!a || !b) throw new Error('merge view not mounted')
  return { a, b }
}

const LONG_ORIGINAL = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
const LONG_MODIFIED = LONG_ORIGINAL.replace('line 15', 'line fifteen')

function renderDiff(props: Partial<ComponentProps<typeof DiffEditor>> = {}) {
  const ref = createRef<TextEditorHandle>()
  const onDirtyChange = vi.fn()
  const result = render(
    <DiffEditor
      ref={ref}
      original="const a = 1"
      modified="const a = 2"
      filePath="src/a.ts"
      collapseUnchanged={false}
      onDirtyChange={onDirtyChange}
      {...props}
    />,
  )
  return { ref, onDirtyChange, ...result }
}

describe('DiffEditor', () => {
  it('shows the original read-only beside the editable working copy', () => {
    renderDiff()
    const { a, b } = views()
    expect(a.state.doc.toString()).toBe('const a = 1')
    expect(b.state.doc.toString()).toBe('const a = 2')
    expect(a.state.readOnly).toBe(true)
    expect(b.state.readOnly).toBe(false)
    expect(document.querySelector('.cm-mergeView')).not.toBeNull()
  })

  it('reports the dirty flip once and returns the edited text through the handle', () => {
    const { ref, onDirtyChange } = renderDiff()
    const { b } = views()
    act(() => b.dispatch({ changes: { from: b.state.doc.length, insert: '3' } }))
    act(() => b.dispatch({ changes: { from: b.state.doc.length, insert: '4' } }))
    expect(onDirtyChange.mock.calls).toEqual([[true]])
    expect(ref.current?.getText()).toBe('const a = 234')

    act(() => ref.current?.markSaved())
    expect(onDirtyChange.mock.calls).toEqual([[true], [false]])
  })

  it('writes CRLF back when the loaded file used it', () => {
    const { ref } = renderDiff({ original: 'a\r\nb', modified: 'a\r\nc' })
    const { b } = views()
    expect(b.state.doc.lines).toBe(2)
    act(() => b.dispatch({ changes: { from: b.state.doc.length, insert: '\nd' } }))
    expect(ref.current?.getText()).toBe('a\r\nc\r\nd')
  })

  it('collapses unchanged lines in diff-only mode and expands them for the full file', () => {
    const { rerender, ref, onDirtyChange } = renderDiff({
      original: LONG_ORIGINAL, modified: LONG_MODIFIED, collapseUnchanged: true,
    })
    expect(document.querySelectorAll('.cm-collapsedLines').length).toBeGreaterThan(0)
    rerender(
      <DiffEditor
        ref={ref}
        original={LONG_ORIGINAL}
        modified={LONG_MODIFIED}
        filePath="src/a.ts"
        collapseUnchanged={false}
        onDirtyChange={onDirtyChange}
      />,
    )
    expect(document.querySelectorAll('.cm-collapsedLines').length).toBe(0)
  })

  it('applies an original chunk to the working copy from the revert gutter', async () => {
    const { ref, onDirtyChange } = renderDiff()
    const button = await waitFor(() => {
      const found = document.querySelector('.cm-merge-revert button')
      if (!found) throw new Error('revert control not rendered yet')
      return found
    })
    act(() => {
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    expect(ref.current?.getText()).toBe('const a = 1')
    // Equal-length edit: the full comparison runs once typing pauses.
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true))
  })

  it('destroys the views on unmount', () => {
    const { unmount } = renderDiff()
    unmount()
    expect(document.querySelector('.cm-mergeView')).toBeNull()
  })
})
