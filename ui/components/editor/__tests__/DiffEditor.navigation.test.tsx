/**
 * @vitest-environment jsdom
 */
import { EditorView } from '@codemirror/view'
import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { DiffEditor } from '../DiffEditor'
import type { TextEditorHandle } from '../diffEditorModel'
import { installCodeMirrorShims } from './cmShims'

beforeAll(installCodeMirrorShims)

const ORIGINAL = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')
const MODIFIED = ORIGINAL.replace('line 10', 'line ten').replace('line 30', 'line thirty').replace('line 50', 'line fifty')

const editableView = () => {
  const dom = document.querySelectorAll('.cm-content')[1]
  const view = dom && EditorView.findFromDOM(dom as HTMLElement)
  if (!view) throw new Error('merge view not mounted')
  return view
}
const cursorLine = () => {
  const view = editableView()
  return view.state.doc.lineAt(view.state.selection.main.head).number
}

function renderDiff() {
  const ref = createRef<TextEditorHandle>()
  const onChangePosition = vi.fn()
  render(
    <DiffEditor
      ref={ref}
      original={ORIGINAL}
      modified={MODIFIED}
      filePath="notes.txt"
      collapseUnchanged={false}
      onDirtyChange={vi.fn()}
      onChangePosition={onChangePosition}
    />,
  )
  return { ref, onChangePosition }
}

describe('DiffEditor change navigation', () => {
  it('opens on the first change and reports it', () => {
    const { onChangePosition } = renderDiff()
    expect(cursorLine()).toBe(10)
    expect(onChangePosition).toHaveBeenLastCalledWith({ index: 0, count: 3 })
  })

  it('steps through every change through the handle, wrapping in both directions', () => {
    const { ref, onChangePosition } = renderDiff()
    act(() => ref.current?.goToChange?.(1))
    expect(cursorLine()).toBe(30)
    expect(onChangePosition).toHaveBeenLastCalledWith({ index: 1, count: 3 })
    act(() => ref.current?.goToChange?.(1))
    act(() => ref.current?.goToChange?.(1))
    expect(cursorLine()).toBe(10)
    act(() => ref.current?.goToChange?.(-1))
    expect(cursorLine()).toBe(50)
    expect(onChangePosition).toHaveBeenLastCalledWith({ index: 2, count: 3 })
  })

  it('reports -1 once the cursor leaves a change and a new count after an edit', () => {
    const { onChangePosition } = renderDiff()
    const view = editableView()
    act(() => view.dispatch({ selection: { anchor: view.state.doc.line(20).from } }))
    expect(onChangePosition).toHaveBeenLastCalledWith({ index: -1, count: 3 })
    const line = view.state.doc.line(40)
    act(() => view.dispatch({ changes: { from: line.from, to: line.to, insert: 'line forty' } }))
    expect(onChangePosition).toHaveBeenLastCalledWith(expect.objectContaining({ count: 4 }))
  })

  it('jumps with F7 and Shift+F7 from inside the editor', () => {
    renderDiff()
    const view = editableView()
    act(() => {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', keyCode: 118, bubbles: true, cancelable: true }))
    })
    expect(cursorLine()).toBe(30)
    act(() => {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', keyCode: 118, shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(cursorLine()).toBe(10)
  })
})
