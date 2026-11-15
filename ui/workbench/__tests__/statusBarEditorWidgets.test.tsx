/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useEditorStatus, useTabs } from '../../ide/editor/core/controller'
import {
  Breadcrumbs,
  CaretStatus,
  EncodingStatus,
  IndentStatus,
  LineEndingStatus,
} from '../../ide/editor/core/view/StatusItems'
import { useDocMeta, type DocMeta } from '../../ide/editor/core/model/document'
import { useProject } from '../../ide/platform/project'
import { useContributions } from '../../ide/workbench/contributions'
import { activate as activateEditor } from '../../ide/editor/core'

const PATH = 'D:/ws/proj/ui/sessionExit.ts'

function setActiveEditor(overrides: Partial<DocMeta> = {}) {
  useDocMeta.setState({ [PATH]: meta(overrides) }, true)
  useEditorStatus.setState({
    status: { path: PATH, doc: 1, line: 17, col: 46, offset: 100, selectedChars: 0, selectedLines: 0, carets: 1 },
  })
}

function meta(overrides: Partial<DocMeta> = {}): DocMeta {
  return {
    doc: 1,
    path: PATH,
    language: 'typescript',
    uiMode: null,
    encoding: 'utf-8',
    lineEnding: 'lf',
    readOnly: false,
    dirty: false,
    banner: null,
    indent: { tabSize: 2, insertSpaces: true },
    ...overrides,
  }
}

describe('status bar editor widgets', () => {
  beforeEach(() => {
    useDocMeta.setState({}, true)
    useEditorStatus.setState({ status: null })
  })
  afterEach(cleanup)

  it('shows nothing while no editor tab is active', () => {
    const { container } = render(
      <>
        <CaretStatus />
        <LineEndingStatus />
        <EncodingStatus />
        <IndentStatus />
      </>,
    )
    expect(container.textContent).toBe('')
  })

  it('shows the caret as line:column, 1-based', () => {
    setActiveEditor()
    render(<CaretStatus />)
    expect(screen.getByText('18:47')).toBeTruthy()
  })

  it('shows the selection size and the caret count', () => {
    setActiveEditor()
    useEditorStatus.setState({
      status: { path: PATH, doc: 1, line: 0, col: 0, offset: 0, selectedChars: 12, selectedLines: 2, carets: 1 },
    })
    const { unmount } = render(<CaretStatus />)
    expect(screen.getByText('1:1 (12 chars, 2 line breaks)')).toBeTruthy()
    unmount()
    useEditorStatus.setState({
      status: { path: PATH, doc: 1, line: 0, col: 0, offset: 0, selectedChars: 0, selectedLines: 0, carets: 3 },
    })
    render(<CaretStatus />)
    expect(screen.getByText('3 carets')).toBeTruthy()
  })

  it.each<[DocMeta['lineEnding'], string]>([
    ['lf', 'LF'],
    ['crLf', 'CRLF'],
    ['cr', 'CR'],
  ])('shows the %s line separator as %s', (lineEnding, label) => {
    setActiveEditor({ lineEnding })
    render(<LineEndingStatus />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('shows the file encoding', () => {
    setActiveEditor({ encoding: 'utf-8' })
    render(<EncodingStatus />)
    expect(screen.getByText('UTF-8')).toBeTruthy()
  })

  it('shows the indentation as spaces or tab', () => {
    setActiveEditor({ indent: { tabSize: 2, insertSpaces: true } })
    const { unmount } = render(<IndentStatus />)
    expect(screen.getByText('2 spaces')).toBeTruthy()
    unmount()
    setActiveEditor({ indent: { tabSize: 4, insertSpaces: false } })
    render(<IndentStatus />)
    expect(screen.getByText('Tab (4)')).toBeTruthy()
  })

  it('shows the breadcrumbs of the active file: project, folders, file', () => {
    useProject.setState({ project: { root: 'D:/ws/proj', name: 'proj' } } as never)
    useTabs.setState({
      activePane: 0,
      panes: [{ active: 't1', tabs: [{ id: 't1', input: { kind: 'text', path: PATH } }] }],
    } as never)
    setActiveEditor()
    render(<Breadcrumbs inStatusBar />)
    const nav = screen.getByRole('navigation', { name: 'Breadcrumbs' })
    expect(nav.textContent).toContain('proj')
    expect(nav.textContent).toContain('ui')
    expect(nav.textContent).toContain('sessionExit.ts')
  })

  it('registers the editor widgets with the mock order on the right side', () => {
    const dispose = activateEditor()
    const items = useContributions.getState().statusItems
    const right = ['editor.caret', 'editor.lineEnding', 'editor.encoding', 'editor.indent'].map((id) => items.get(id))
    expect(right.every((i) => i?.align === 'right')).toBe(true)
    const priorities = right.map((i) => i!.priority)
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities)
    expect(items.get('editor.breadcrumbs')?.align).toBe('left')
    if (typeof dispose === 'function') dispose()
  })
})
