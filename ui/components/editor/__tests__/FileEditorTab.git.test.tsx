/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { WorkspaceScript } from '@omniterm/contract'

import { mockOmnitermAPI } from '../../../testUtils'
import { FileEditorTab } from '../FileEditorTab'
import { installCodeMirrorShims } from './cmShims'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))

vi.mock('../../git/GitFileHistoryModal', () => ({
  GitFileHistoryModal: (props: { filePath: string; range?: { start: number; end: number } }) => (
    <div data-testid="history">{`${props.filePath}|${props.range ? `${props.range.start}-${props.range.end}` : 'all'}`}</div>
  ),
}))
vi.mock('../../git/GitBranchCompareModal', () => ({
  GitBranchCompareModal: (props: { onSelectBranch: (branch: string) => void }) => (
    <button onClick={() => props.onSelectBranch('develop')}>pick-develop</button>
  ),
}))
vi.mock('../../git/GitDiffViewer', () => ({
  GitDiffViewer: (props: { onClose: () => void }) => <button onClick={props.onClose}>close-diff</button>,
}))

const script: WorkspaceScript = { id: 'f/app.ts', name: 'app.ts', path: 'f/app.ts', kind: 'ts', viewable: true }

function setup() {
  const openTextFile = vi.fn(async () => ({
    content: 'one\ntwo\n', size: 8, mtimeMs: 1, lineCount: 3, maxLineLen: 3, eol: 'lf' as const,
    mixedEol: false, hasBom: false, readOnly: false,
  }))
  mockOmnitermAPI({ workspace: { openTextFile } })
  return openTextFile
}

const editorContent = async () => {
  await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull())
  return document.querySelector('.cm-content') as HTMLElement
}

beforeAll(() => installCodeMirrorShims())
afterEach(() => vi.clearAllMocks())

describe('FileEditorTab Git actions', () => {
  it('offers Git commands on right-click for a file inside a repository', async () => {
    mockInvoke.mockResolvedValue({ repo_root: 'D:/repo', relative_path: 'src/app.ts', branch: 'main' })
    const openTextFile = setup()
    render(<FileEditorTab tabId="t" workspaceId="w" script={script} visible onClose={vi.fn()} onRun={vi.fn()} />)
    const content = await editorContent()
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('git_file_context', { workspaceId: 'w', path: 'f/app.ts' }))

    await waitFor(() => {
      fireEvent.contextMenu(content, { clientX: 5, clientY: 5 })
      expect(screen.getByRole('group', { name: 'Git · main' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'History of selection' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'History of selection' }))
    expect(screen.getByTestId('history')).toHaveTextContent('src/app.ts|1-1')

    // A branch diff may write the file, so the editor re-reads it once the diff closes.
    fireEvent.contextMenu(content, { clientX: 5, clientY: 5 })
    fireEvent.click(screen.getByRole('button', { name: 'Compare with branch…' }))
    fireEvent.click(screen.getByText('pick-develop'))
    fireEvent.click(screen.getByText('close-diff'))
    await waitFor(() => expect(openTextFile).toHaveBeenCalledTimes(2))
  })

  it('keeps the menu Git-free for a file outside any repository', async () => {
    mockInvoke.mockRejectedValue(new Error('not a git repository'))
    setup()
    render(<FileEditorTab tabId="t2" workspaceId="w" script={script} visible onClose={vi.fn()} onRun={vi.fn()} />)
    const content = await editorContent()
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled())
    fireEvent.contextMenu(content, { clientX: 5, clientY: 5 })
    expect(screen.getByRole('dialog', { name: 'Editor actions' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /^Git/ })).toBeNull()
  })
})
