/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { history } from '@codemirror/commands'
import { searchPanelOpen } from '@codemirror/search'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { findEditorView, isCommandEnabled, isWrapping, runEditorCommand } from '../editorCommands'
import { EditorSurface } from '../EditorSurface'
import { installCodeMirrorShims } from './cmShims'

const clipboard = { writeText: vi.fn(), readText: vi.fn() }
const views: EditorView[] = []

function mount(doc: string, options: { readOnly?: boolean; anchor?: number; head?: number; parent?: HTMLElement } = {}) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(options.anchor ?? 0, options.head ?? options.anchor ?? 0),
      extensions: [history(), EditorState.readOnly.of(options.readOnly ?? false)],
    }),
    parent: options.parent ?? document.body,
  })
  views.push(view)
  return view
}

beforeAll(installCodeMirrorShims)
beforeEach(() => {
  clipboard.writeText.mockReset().mockResolvedValue(undefined)
  clipboard.readText.mockReset().mockResolvedValue('pasted')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
})
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.innerHTML = ''
})

describe('editor commands', () => {
  it('copies, cuts and pastes through the clipboard', async () => {
    const view = mount('hello world', { anchor: 0, head: 5 })
    await runEditorCommand('copy', view)
    expect(clipboard.writeText).toHaveBeenLastCalledWith('hello')

    await runEditorCommand('cut', view)
    expect(view.state.doc.toString()).toBe(' world')

    await runEditorCommand('paste', view)
    expect(view.state.doc.toString()).toBe('pasted world')

    await runEditorCommand('undo', view)
    expect(view.state.doc.toString()).toBe(' world')
  })

  it('toggles word wrap and opens the search panel', async () => {
    const view = mount('text')
    expect(isWrapping(view.state)).toBe(false)
    await runEditorCommand('wrap', view)
    expect(isWrapping(view.state)).toBe(true)
    await runEditorCommand('wrap', view)
    expect(isWrapping(view.state)).toBe(false)

    await runEditorCommand('find', view)
    expect(searchPanelOpen(view.state)).toBe(true)
    await expect(runEditorCommand('fold', view)).resolves.toBeUndefined()
  })

  it('disables edits on read-only text and selection actions without a selection', () => {
    const readOnly = mount('locked', { readOnly: true, anchor: 0, head: 3 })
    expect(isCommandEnabled('cut', readOnly.state)).toBe(false)
    expect(isCommandEnabled('paste', readOnly.state)).toBe(false)
    expect(isCommandEnabled('copy', readOnly.state)).toBe(true)

    const empty = mount('free')
    expect(isCommandEnabled('copy', empty.state)).toBe(false)
    expect(isCommandEnabled('undo', empty.state)).toBe(false)
    expect(isCommandEnabled('wrap', empty.state)).toBe(true)
  })

  it('targets the editor under the pointer, else the editable one in scope', () => {
    const scope = document.createElement('div')
    document.body.append(scope)
    const base = mount('base', { readOnly: true, parent: scope })
    const working = mount('working', { parent: scope })

    expect(findEditorView(base.contentDOM, scope)).toBe(base)
    expect(findEditorView(scope, scope)).toBe(working)
    expect(findEditorView(null, document.createElement('div'))).toBeNull()
  })
})

describe('EditorSurface actions panel', () => {
  it('runs the chosen action on the right-clicked editor', async () => {
    const host = document.createElement('div')
    render(<EditorSurface label="Test editor"><div ref={(node) => { if (node && !node.firstChild) node.append(host) }} /></EditorSurface>)
    const view = mount('hello', { anchor: 0, head: 5, parent: host })

    fireEvent.contextMenu(view.contentDOM)
    const copy = screen.getByRole('button', { name: /Copy/ })
    expect(copy).toBeEnabled()
    expect(screen.getByRole('button', { name: /Undo/ })).toBeDisabled()
    fireEvent.click(copy)
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('hello'))
    expect(screen.queryByRole('dialog', { name: 'Editor actions' })).not.toBeInTheDocument()
  })
})
