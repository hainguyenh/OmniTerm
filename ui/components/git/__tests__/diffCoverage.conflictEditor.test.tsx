/** @vitest-environment jsdom */
import { EditorView } from '@codemirror/view'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { TextEditorHandle } from '../../editor/diffEditorModel'
import { installCodeMirrorShims } from '../../editor/__tests__/cmShims'
import { GitConflictEditor } from '../GitConflictEditor'

beforeAll(installCodeMirrorShims)

const TWO_CONFLICTS = [
  'top',
  '<<<<<<< HEAD',
  'ours one',
  '=======',
  'theirs one',
  '>>>>>>> topic',
  'middle',
  '<<<<<<< HEAD',
  '=======',
  'theirs two',
  '>>>>>>> topic',
  'bottom',
].join('\n')

const EMPTY_INCOMING = ['<<<<<<< HEAD', 'kept', '=======', '>>>>>>> topic'].join('\n')

const resultView = () => {
  const dom = document.querySelector('.conflict-editor-code .cm-content')
  const view = dom ? EditorView.findFromDOM(dom as HTMLElement) : null
  if (!view) throw new Error('no result editor')
  return view
}

function renderConflict(content: string) {
  const ref = createRef<TextEditorHandle>()
  const onDirtyChange = vi.fn()
  const utils = render(<GitConflictEditor ref={ref} content={content} filePath="src/a.ts" onDirtyChange={onDirtyChange} />)
  return { ref, onDirtyChange, ...utils }
}

describe('GitConflictEditor', () => {
  it('lists each conflict on both sides and marks empty sides', () => {
    renderConflict(TWO_CONFLICTS)
    expect(screen.getByText('Merge Conflicts: 2 remaining')).toBeInTheDocument()
    expect(screen.getAllByText('Conflict 1')).toHaveLength(2)
    expect(screen.getAllByText('Conflict 2')).toHaveLength(2)
    expect(screen.getByText('theirs one', { selector: '.is-incoming pre' })).toBeInTheDocument()
    expect(screen.getByText('ours one', { selector: '.is-current pre' })).toBeInTheDocument()
    // The second conflict has no current-side lines.
    expect(screen.getAllByText('(empty)')).toHaveLength(1)
    expect(resultView().state.doc.toString()).toBe(TWO_CONFLICTS)
  })

  it('applies incoming and current choices as edits and reports all resolved', () => {
    const { ref, onDirtyChange } = renderConflict(TWO_CONFLICTS)
    fireEvent.click(screen.getAllByRole('button', { name: /Use incoming/ })[0])
    expect(screen.getByText('Merge Conflicts: 1 remaining')).toBeInTheDocument()
    expect(resultView().state.doc.toString()).toContain('top\ntheirs one\nmiddle')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: /Use current/ }))
    expect(screen.getByText('All conflicts resolved')).toBeInTheDocument()
    expect(ref.current?.getText()).toBe('top\ntheirs one\nmiddle\nbottom')
    expect(screen.queryByText('Conflict 1')).toBeNull()
  })

  it('shows an empty incoming side and resolves to the current lines', () => {
    const { ref } = renderConflict(EMPTY_INCOMING)
    expect(screen.getAllByText('(empty)')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Use current/ }))
    expect(ref.current?.getText()).toBe('kept')
  })

  it('re-parses blocks only after typing pauses', async () => {
    const { onDirtyChange } = renderConflict(TWO_CONFLICTS)
    const view = resultView()
    act(() => view.dispatch({ changes: { from: 0, to: 3, insert: 'TOP' } }))
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'no conflicts here' } }))
    expect(onDirtyChange).toHaveBeenCalledWith(true)
    // The rendered blocks lag until the reparse delay elapses.
    expect(screen.getByText('Merge Conflicts: 2 remaining')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('All conflicts resolved')).toBeInTheDocument())
  })

  it('ignores a stale accept when the live text no longer has that conflict', () => {
    renderConflict(TWO_CONFLICTS)
    const view = resultView()
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'resolved by hand' } }))
    fireEvent.click(screen.getAllByRole('button', { name: /Use incoming/ })[1])
    expect(view.state.doc.toString()).toBe('resolved by hand')
  })

  it('keeps the incoming and current panes scrolled together', () => {
    renderConflict(TWO_CONFLICTS)
    const [left, right] = [...document.querySelectorAll<HTMLDivElement>('.git-conflict-panes .overflow-auto')]
    left.scrollTop = 40
    fireEvent.scroll(left)
    expect(right.scrollTop).toBe(40)
    right.scrollTop = 12
    fireEvent.scroll(right)
    expect(left.scrollTop).toBe(12)
  })

  it('serializes with the original line endings and clears dirty state when saved', () => {
    const crlf = TWO_CONFLICTS.replace(/\n/g, '\r\n')
    const { ref, onDirtyChange } = renderConflict(crlf)
    const view = resultView()
    act(() => view.dispatch({ changes: { from: 0, insert: 'x' } }))
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect(ref.current?.getText()).toBe(`x${crlf}`)
    act(() => ref.current?.markSaved())
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('rebuilds the editor when new content arrives', () => {
    const { rerender, ref } = renderConflict(TWO_CONFLICTS)
    rerender(<GitConflictEditor ref={ref} content={EMPTY_INCOMING} filePath="src/a.ts" onDirtyChange={vi.fn()} />)
    expect(resultView().state.doc.toString()).toBe(EMPTY_INCOMING)
    expect(document.querySelectorAll('.conflict-editor-code .cm-editor')).toHaveLength(1)
  })
})
