/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceScript } from '@omniterm/contract'

import { mockOmnitermAPI } from '../../../testUtils'
import type { TextFileContent, TextFileSaveOutcome } from '../../../utils/textFileWire'
import { FileEditorTab } from '../FileEditorTab'
import { installCodeMirrorShims } from './cmShims'

vi.mock('../../MarkdownPreview', () => ({
  default: ({ content, onFallback }: { content: string; onFallback: () => void }) => (
    <div data-testid="markdown">{content}<button onClick={onFallback}>md-fallback</button></div>
  ),
}))

const script = (name: string, extra: Partial<WorkspaceScript> = {}): WorkspaceScript => ({
  id: `f/${name}`, name, path: `f/${name}`, kind: name.split('.').pop() ?? 'file', viewable: true, ...extra,
})

const file = (content: string, extra: Partial<TextFileContent> = {}): TextFileContent => ({
  content, size: content.length, mtimeMs: 10, lineCount: content.split('\n').length, maxLineLen: 20,
  eol: 'lf', mixedEol: false, hasBom: false, readOnly: false, ...extra,
})

let openTextFile: ReturnType<typeof vi.fn>
let saveTextFile: ReturnType<typeof vi.fn>

function setup(content: TextFileContent | Error, outcome: TextFileSaveOutcome = { status: 'saved', size: 5, mtimeMs: 20 }) {
  openTextFile = vi.fn(async () => {
    if (content instanceof Error) throw content
    return content
  })
  saveTextFile = vi.fn(async () => outcome)
  mockOmnitermAPI({ workspace: { openTextFile, saveTextFile } })
}

const editorView = async () => {
  await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull())
  return document.querySelector('.cm-content') as HTMLElement
}

/** Type through CodeMirror's own input path: replace the document via its view. */
async function typeInEditor(text: string) {
  const { EditorView } = await import('@codemirror/view')
  const view = EditorView.findFromDOM(await editorView())
  if (!view) throw new Error('no editor view')
  act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: text } }) })
  return view
}

beforeAll(() => installCodeMirrorShims())

describe('FileEditorTab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads only once visible, edits in place and saves with Ctrl+S', async () => {
    setup(file('let a = 1\n'))
    const onDirtyChange = vi.fn()
    const { rerender } = render(
      <FileEditorTab tabId="t1" workspaceId="w" script={script('app.ts')} visible={false}
        onClose={vi.fn()} onRun={vi.fn()} onDirtyChange={onDirtyChange} />,
    )
    expect(openTextFile).not.toHaveBeenCalled()
    rerender(
      <FileEditorTab tabId="t1" workspaceId="w" script={script('app.ts')} visible
        onClose={vi.fn()} onRun={vi.fn()} onDirtyChange={onDirtyChange} />,
    )
    expect(openTextFile).toHaveBeenCalledWith('w', 'f/app.ts')
    await typeInEditor('x')
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
    // File identity stays in the compact breadcrumb; language metadata belongs in the status bar.
    expect(screen.getByRole('navigation', { name: 'File path' })).toHaveTextContent('app.ts')
    expect(within(document.querySelector('.file-editor-status') as HTMLElement).getByText('TypeScript')).toBeInTheDocument()

    fireEvent.keyDown(await editorView(), { key: 's', ctrlKey: true })
    await waitFor(() => expect(saveTextFile).toHaveBeenCalledTimes(1))
    expect(saveTextFile).toHaveBeenCalledWith('w', 'f/app.ts', {
      content: 'let a = 1\nx', bom: false, expectedMtimeMs: 10, expectedSize: 10, force: false,
    })
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
  })

  it('keeps the document across hide and show', async () => {
    setup(file('one'))
    const props = { tabId: 't2', workspaceId: 'w', script: script('notes.txt'), onClose: vi.fn(), onRun: vi.fn() }
    const { rerender } = render(<FileEditorTab {...props} visible />)
    await typeInEditor('!')
    rerender(<FileEditorTab {...props} visible={false} />)
    expect(document.querySelector('.cm-content')).toBeNull()
    rerender(<FileEditorTab {...props} visible />)
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toBe('one!'))
    expect(openTextFile).toHaveBeenCalledTimes(1)
  })

  it('shows a conflict, then overwrites or reloads on request', async () => {
    setup(file('v1'), { status: 'conflict', reason: 'modified', diskMtimeMs: 99 })
    render(<FileEditorTab tabId="t3" workspaceId="w" script={script('a.json')} visible onClose={vi.fn()} onRun={vi.fn()} />)
    await typeInEditor('2')
    fireEvent.click(screen.getByLabelText('Save (Ctrl+S)'))
    await screen.findByText(/changed on disk/)
    saveTextFile.mockResolvedValueOnce({ status: 'saved', size: 3, mtimeMs: 50 })
    fireEvent.click(screen.getByText('Overwrite'))
    await waitFor(() => expect(saveTextFile).toHaveBeenLastCalledWith('w', 'f/a.json', expect.objectContaining({ force: true })))
    await waitFor(() => expect(screen.queryByText(/changed on disk/)).toBeNull())

    saveTextFile.mockResolvedValueOnce({ status: 'conflict', reason: 'modified' })
    await typeInEditor('3')
    fireEvent.click(screen.getByLabelText('Save (Ctrl+S)'))
    await screen.findByText('Reload from disk')
    openTextFile.mockResolvedValueOnce(file('from disk'))
    fireEvent.click(screen.getByText('Reload from disk'))
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toBe('from disk'))
  })

  it('reports deleted files and save errors in banners', async () => {
    setup(file('x'), { status: 'conflict', reason: 'deleted' })
    render(<FileEditorTab tabId="t4" workspaceId="w" script={script('gone.md')} visible onClose={vi.fn()} onRun={vi.fn()} />)
    await typeInEditor('y')
    fireEvent.click(screen.getByLabelText('Save (Ctrl+S)'))
    await screen.findByText(/deleted on disk/)
    saveTextFile.mockRejectedValueOnce(new Error('disk full'))
    fireEvent.click(screen.getByText('Save anyway'))
    await screen.findByText('disk full')
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByText('disk full')).toBeNull()
  })

  it('saves before running a dirty script and stops if the save fails', async () => {
    setup(file('echo 1'))
    const onRun = vi.fn()
    render(<FileEditorTab tabId="t5" workspaceId="w" script={script('run.sh', { kind: 'sh' })} visible onClose={vi.fn()} onRun={onRun} />)
    await editorView()
    fireEvent.click(screen.getByLabelText('Run'))
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1))
    expect(saveTextFile).not.toHaveBeenCalled()

    await typeInEditor('\necho 2')
    saveTextFile.mockRejectedValueOnce(new Error('denied'))
    fireEvent.click(screen.getByLabelText('Run'))
    await screen.findByText('denied')
    expect(onRun).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText('Run'))
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(2))
  })

  it('shows the load error, or a placeholder for files the scan cannot show', async () => {
    setup(new Error('This file is 30 MB and the viewer limit is 1 MB.'))
    const onRun = vi.fn()
    const { unmount } = render(<FileEditorTab tabId="t6" workspaceId="w" script={script('big.log')} visible onClose={vi.fn()} onRun={onRun} />)
    await screen.findByText(/viewer limit/)
    unmount()
    render(<FileEditorTab tabId="t7" workspaceId="w" script={script('tool.rdp', { kind: 'rdp', viewable: false })} visible onClose={vi.fn()} onRun={onRun} />)
    const placeholder = screen.getByText('Content not available to view').parentElement as HTMLElement
    // The header offers Launch too; the placeholder's own button must run the file.
    expect(screen.getAllByRole('button', { name: 'Launch' })).toHaveLength(2)
    fireEvent.click(within(placeholder).getByRole('button', { name: 'Launch' }))
    expect(onRun).toHaveBeenCalled()
    // Only the first tab read its file; the non-viewable one never asks.
    expect(openTextFile).toHaveBeenCalledTimes(1)
  })

  it('switches between code, split and preview, and falls back to code', async () => {
    setup(file('# Title'))
    render(<FileEditorTab tabId="t8" workspaceId="w" script={script('README.md')} visible onClose={vi.fn()} onRun={vi.fn()} />)
    await editorView()
    fireEvent.click(screen.getByLabelText('Split'))
    expect(await screen.findByTestId('markdown')).toHaveTextContent('# Title')
    expect(document.querySelector('.cm-content')).not.toBeNull()
    fireEvent.click(screen.getByLabelText('Preview'))
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeNull())
    fireEvent.click(screen.getByText('md-fallback'))
    await screen.findByText(/showing the source instead/)
    await editorView()
    fireEvent.click(screen.getAllByLabelText('Dismiss')[0])
    expect(screen.queryByText(/showing the source instead/)).toBeNull()
  })

  it('jumps from a JSON syntax error in the preview to the code', async () => {
    setup(file('{"a": }'))
    render(<FileEditorTab tabId="t11" workspaceId="w" script={script('bad.json')} visible onClose={vi.fn()} onRun={vi.fn()} />)
    await editorView()
    fireEvent.click(screen.getByLabelText('Preview'))
    fireEvent.click(await screen.findByText('Go to error'))
    const { EditorView } = await import('@codemirror/view')
    await waitFor(() => {
      const view = EditorView.findFromDOM(document.querySelector('.cm-content') as HTMLElement)
      expect(view?.state.selection.main.head).toBe(6)
    })
    // Already showing code: the jump applies directly.
    fireEvent.click(screen.getByText('Go to error'))
    expect(screen.getByLabelText('Split')).toHaveAttribute('aria-pressed', 'true')
  })

  it('flags read-only files, degraded profiles and toggles line ending and BOM', async () => {
    setup(file('x'.repeat(20), { readOnly: true, maxLineLen: 20_000, mixedEol: true }))
    render(<FileEditorTab tabId="t9" workspaceId="w" script={script('min.js')} visible onClose={vi.fn()} onRun={vi.fn()} />)
    await screen.findByText(/read-only on disk/)
    expect(screen.getByText(/Very long lines/)).toBeInTheDocument()
    expect(screen.getByText('JavaScript (plain)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Save (Ctrl+S)')).toBeNull()
    expect(screen.getByText('Mixed → LF')).toBeDisabled()
  })

  it('marks the file dirty when the line ending or BOM changes', async () => {
    setup(file('a'))
    const onDirtyChange = vi.fn()
    render(<FileEditorTab tabId="t10" workspaceId="w" script={script('a.ps1', { kind: 'ps1' })} visible
      onClose={vi.fn()} onRun={vi.fn()} onDirtyChange={onDirtyChange} />)
    await editorView()
    fireEvent.click(screen.getByText('LF'))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
    fireEvent.click(screen.getByText('CRLF'))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
    fireEvent.click(screen.getByText('UTF-8'))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
    fireEvent.click(screen.getByLabelText('Save (Ctrl+S)'))
    await waitFor(() => expect(saveTextFile).toHaveBeenCalledWith('w', 'f/a.ps1', expect.objectContaining({ bom: true, content: 'a' })))
  })
})
