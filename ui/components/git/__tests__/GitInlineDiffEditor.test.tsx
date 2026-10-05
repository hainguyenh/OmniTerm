/**
 * @vitest-environment jsdom
 */
import { EditorView } from '@codemirror/view'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { TextEditorHandle } from '../../editor/diffEditorModel'
import { installCodeMirrorShims } from '../../editor/__tests__/cmShims'
import { GitInlineDiffEditor } from '../GitInlineDiffEditor'

beforeAll(installCodeMirrorShims)

const CONFLICT_CONTENT = `line 1
<<<<<<< HEAD
local version
=======
server version
>>>>>>> origin/main
line 5`

const editorViews = () =>
  [...document.querySelectorAll('.cm-content')].map((dom) => {
    const view = EditorView.findFromDOM(dom as HTMLElement)
    if (!view) throw new Error('no editor view')
    return view
  })

function renderEditor(localContent: string, serverContent: string, viewMode: 'diff' | 'full' = 'diff') {
  const ref = createRef<TextEditorHandle>()
  const onDirtyChange = vi.fn()
  render(
    <GitInlineDiffEditor
      ref={ref}
      localContent={localContent}
      serverContent={serverContent}
      filePath="src/test.ts"
      viewMode={viewMode}
      onDirtyChange={onDirtyChange}
    />,
  )
  return { ref, onDirtyChange }
}

describe('GitInlineDiffEditor', () => {
  it('renders the 2-way diff in the shared CodeMirror merge view', () => {
    renderEditor('const a = 2', 'const a = 1')
    expect(screen.getByText('Base version')).toBeInTheDocument()
    expect(screen.getByText('Working copy')).toBeInTheDocument()
    expect(document.querySelector('.cm-mergeView')).not.toBeNull()
    const [server, local] = editorViews()
    expect(server.state.doc.toString()).toBe('const a = 1')
    expect(local.state.doc.toString()).toBe('const a = 2')
  })

  it('resizes the base side with the chunk-column divider and remembers it', () => {
    localStorage.clear()
    renderEditor('const a = 2', 'const a = 1')
    const container = document.querySelector<HTMLElement>('.git-diff-split')
    const split = () => container?.style.getPropertyValue('--git-diff-split')
    expect(split()).toBe('0.5')
    const divider = screen.getByRole('separator', { name: 'Resize base and working copy panes' })
    // jsdom has no layout: the drag scale falls back to one unit per pixel, clamped to the bounds.
    fireEvent.mouseDown(divider, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 100.25 })
    expect(split()).toBe('0.75')
    fireEvent.mouseMove(window, { clientX: 50 })
    expect(split()).toBe('0.15')
    fireEvent.mouseUp(window)
    expect(localStorage.getItem('omniterm:git-diff-split')).toBe('0.15')
    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    expect(Number(split())).toBeCloseTo(0.2)
    fireEvent.doubleClick(divider)
    expect(split()).toBe('0.5')
  })

  it('keeps the full file expanded in full mode', () => {
    const server = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    renderEditor(server.replace('l10', 'changed'), server, 'full')
    expect(document.querySelectorAll('.cm-collapsedLines').length).toBe(0)
  })

  it('edits the working copy without echoing every keystroke to the host', () => {
    const { ref, onDirtyChange } = renderEditor('const a = 2', 'const a = 1', 'full')
    const [, local] = editorViews()
    act(() => local.dispatch({ changes: { from: local.state.doc.length, insert: '9' } }))
    act(() => local.dispatch({ changes: { from: local.state.doc.length, insert: '9' } }))
    expect(onDirtyChange.mock.calls).toEqual([[true]])
    expect(ref.current?.getText()).toBe('const a = 299')
  })

  it('renders the 3-way layout when the loaded file has merge conflicts', () => {
    renderEditor(CONFLICT_CONTENT, 'base version')
    expect(screen.getByText(/Merge Conflicts: 1 remaining/)).toBeInTheDocument()
    expect(screen.getByText('Incoming changes')).toBeInTheDocument()
    expect(screen.getByText('Result · final version')).toBeInTheDocument()
    expect(screen.getByText('Current changes')).toBeInTheDocument()
    expect(editorViews()).toHaveLength(1)
  })

  it('accepts the server side into the result as an undoable edit', () => {
    const { ref, onDirtyChange } = renderEditor(CONFLICT_CONTENT, 'base version')
    fireEvent.click(screen.getByRole('button', { name: 'Use incoming' }))
    expect(ref.current?.getText()).toBe('line 1\nserver version\nline 5')
    expect(onDirtyChange).toHaveBeenCalledWith(true)
    expect(screen.getByText('All conflicts resolved')).toBeInTheDocument()
  })

  it('accepts the local side into the result', () => {
    const { ref } = renderEditor(CONFLICT_CONTENT, 'base version')
    fireEvent.click(screen.getByRole('button', { name: 'Use current' }))
    expect(ref.current?.getText()).toBe('line 1\nlocal version\nline 5')
  })

  it('re-parses the conflict blocks after typing pauses', async () => {
    renderEditor(CONFLICT_CONTENT, 'base version')
    const [result] = editorViews()
    act(() => result.dispatch({ changes: { from: 0, to: result.state.doc.length, insert: 'resolved by hand' } }))
    await waitFor(() => expect(screen.getByText('All conflicts resolved')).toBeInTheDocument())
  })

  it('keeps CRLF line endings for a conflicted CRLF file', () => {
    const { ref } = renderEditor(CONFLICT_CONTENT.replace(/\n/g, '\r\n'), 'base version')
    fireEvent.click(screen.getByRole('button', { name: 'Use incoming' }))
    expect(ref.current?.getText()).toBe('line 1\r\nserver version\r\nline 5')
  })
})
