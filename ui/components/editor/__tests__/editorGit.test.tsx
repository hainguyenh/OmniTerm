/**
 * @vitest-environment jsdom
 */
import { EditorSelection, EditorState } from '@codemirror/state'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { EditorView } from '@codemirror/view'
import { History } from 'lucide-react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitFileContext } from '../../git/gitTypes'
import { EditorGitDialogs } from '../EditorGitDialogs'
import { editorGitActions, selectionLineRange, type EditorGitDialog } from '../editorGitActions'
import { EditorSurface } from '../EditorSurface'
import { useGitFileContext } from '../useGitFileContext'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))

vi.mock('../../git/GitFileHistoryModal', () => ({
  GitFileHistoryModal: (props: { cwd: string; filePath: string; range?: { start: number; end: number }; onClose: () => void }) => (
    <div data-testid="history">
      {`${props.cwd}|${props.filePath}|${props.range ? `${props.range.start}-${props.range.end}` : 'all'}`}
      <button onClick={props.onClose}>close-history</button>
    </div>
  ),
}))
vi.mock('../../git/GitBlameModal', () => ({
  GitBlameModal: (props: { filePath: string; onClose: () => void }) => (
    <div data-testid="blame">{props.filePath}<button onClick={props.onClose}>close-blame</button></div>
  ),
}))
vi.mock('../../git/GitBranchCompareModal', () => ({
  GitBranchCompareModal: (props: { currentBranch?: string; onSelectBranch: (branch: string) => void; onClose: () => void }) => (
    <div data-testid="compare">
      {props.currentBranch}
      {/* The real picker closes itself right after reporting a selection. */}
      <button onClick={() => { props.onSelectBranch('develop'); props.onClose() }}>pick-develop</button>
      <button onClick={props.onClose}>close-compare</button>
    </div>
  ),
}))
vi.mock('../../git/GitDiffViewer', () => ({
  GitDiffViewer: (props: { filePath: string; targetBranch?: string; staged: boolean; onClose: () => void }) => (
    <div data-testid="diff">{`${props.filePath}@${props.targetBranch}:${String(props.staged)}`}<button onClick={props.onClose}>close-diff</button></div>
  ),
}))

const CONTEXT: GitFileContext = { repo_root: 'D:/repo', relative_path: 'src/app.ts', branch: 'main' }

const stateWith = (doc: string, anchor: number, head = anchor) =>
  EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })

afterEach(() => vi.clearAllMocks())

describe('selectionLineRange', () => {
  const doc = 'one\ntwo\nthree\nfour\n'

  it('covers the lines the main selection touches', () => {
    expect(selectionLineRange(stateWith(doc, 0))).toEqual({ start: 1, end: 1 })
    expect(selectionLineRange(stateWith(doc, 5, 10))).toEqual({ start: 2, end: 3 })
    expect(selectionLineRange(stateWith(doc, 10, 5))).toEqual({ start: 2, end: 3 })
  })

  it('drops a final line the selection only reaches the start of', () => {
    // "two\n" selected by dragging from the start of line 2 to the start of line 3.
    expect(selectionLineRange(stateWith(doc, 4, 8))).toEqual({ start: 2, end: 2 })
  })
})

describe('editorGitActions', () => {
  it('names the branch and opens each dialog', () => {
    const setDialog = vi.fn()
    const group = editorGitActions(CONTEXT, setDialog)
    expect(group.heading).toBe('Git · main')
    expect(editorGitActions({ ...CONTEXT, branch: undefined }, setDialog).heading).toBe('Git')

    const byId = Object.fromEntries(group.items.map((item) => [item.id, item]))
    byId['git-file-history'].onSelect(null)
    byId['git-compare-branch'].onSelect(null)
    byId['git-blame'].onSelect(null)
    expect(byId['git-selection-history'].needsView).toBe(true)
    byId['git-selection-history'].onSelect(null)
    byId['git-selection-history'].onSelect({ state: stateWith('a\nb\nc', 2, 5) } as unknown as EditorView)
    expect(setDialog.mock.calls.map(([dialog]) => dialog)).toEqual([
      { type: 'history' },
      { type: 'compare' },
      { type: 'blame' },
      { type: 'history', range: { start: 2, end: 3 } },
    ])
  })
})

describe('EditorSurface host actions', () => {
  it('lists the group under the editing commands and runs the chosen one', () => {
    const onSelect = vi.fn()
    const viewOnly = vi.fn()
    render(
      <EditorSurface actions={{ heading: 'Git · main', items: [
        { id: 'a', label: 'File history', Icon: History, onSelect },
        { id: 'b', label: 'History of selection', Icon: History, needsView: true, onSelect: viewOnly },
      ] }}>
        <div data-testid="content">text</div>
      </EditorSurface>,
    )
    fireEvent.contextMenu(screen.getByTestId('content'), { clientX: 10, clientY: 10 })
    const group = screen.getByRole('group', { name: 'Git · main' })
    expect(group).toHaveTextContent('File history')
    // No CodeMirror view under the pointer here, so the selection action cannot run.
    expect(screen.getByRole('button', { name: 'History of selection' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'File history' }))
    expect(onSelect).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('dialog', { name: 'Editor actions' })).toBeNull()
    expect(viewOnly).not.toHaveBeenCalled()
  })

  it('shows no group when the host has no actions', () => {
    render(<EditorSurface actions={{ heading: 'Git', items: [] }}><div data-testid="content" /></EditorSurface>)
    fireEvent.contextMenu(screen.getByTestId('content'))
    expect(screen.queryByRole('group', { name: 'Git' })).toBeNull()
  })
})

describe('EditorGitDialogs', () => {
  function Harness({ initial, onDiffClosed = vi.fn() }: { initial: EditorGitDialog | null; onDiffClosed?: () => void }) {
    const [dialog, setDialog] = useState<EditorGitDialog | null>(initial)
    return <EditorGitDialogs context={CONTEXT} dialog={dialog} setDialog={setDialog} onDiffClosed={onDiffClosed} />
  }

  it('opens the history with the repository path and range, and closes it', () => {
    render(<Harness initial={{ type: 'history', range: { start: 3, end: 7 } }} />)
    expect(screen.getByTestId('history')).toHaveTextContent('D:/repo|src/app.ts|3-7')
    fireEvent.click(screen.getByText('close-history'))
    expect(screen.queryByTestId('history')).toBeNull()
  })

  it('opens blame for the repository-relative path', () => {
    render(<Harness initial={{ type: 'blame' }} />)
    expect(screen.getByTestId('blame')).toHaveTextContent('src/app.ts')
    fireEvent.click(screen.getByText('close-blame'))
    expect(screen.queryByTestId('blame')).toBeNull()
  })

  it('goes from the branch picker to the branch diff and tells the editor when it closes', () => {
    const onDiffClosed = vi.fn()
    render(<Harness initial={{ type: 'compare' }} onDiffClosed={onDiffClosed} />)
    expect(screen.getByTestId('compare')).toHaveTextContent('main')
    fireEvent.click(screen.getByText('pick-develop'))
    // The picker's own close after selecting must not dismiss the diff it just opened.
    expect(screen.getByTestId('diff')).toHaveTextContent('src/app.ts@develop:false')
    fireEvent.click(screen.getByText('close-diff'))
    expect(screen.queryByTestId('diff')).toBeNull()
    expect(onDiffClosed).toHaveBeenCalledTimes(1)
  })

  it('closes the picker without a selection', () => {
    render(<Harness initial={{ type: 'compare' }} />)
    fireEvent.click(screen.getByText('close-compare'))
    expect(screen.queryByTestId('compare')).toBeNull()
  })
})

describe('useGitFileContext', () => {
  beforeEach(() => { mockInvoke.mockResolvedValue(CONTEXT) })

  it('resolves once enabled, re-resolves on git refresh and ignores other files', async () => {
    const { result, rerender } = renderHook(
      ({ path, enabled }) => useGitFileContext('w', path, enabled),
      { initialProps: { path: 'f/app.ts', enabled: false } },
    )
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(result.current).toBeNull()

    rerender({ path: 'f/app.ts', enabled: true })
    await waitFor(() => expect(result.current).toEqual(CONTEXT))
    expect(mockInvoke).toHaveBeenCalledWith('git_file_context', { workspaceId: 'w', path: 'f/app.ts' })

    mockInvoke.mockResolvedValueOnce({ ...CONTEXT, branch: 'develop' })
    act(() => { window.dispatchEvent(new CustomEvent('omniterm:git-refresh')) })
    await waitFor(() => expect(result.current?.branch).toBe('develop'))

    mockInvoke.mockReturnValueOnce(new Promise(() => {}))
    rerender({ path: 'f/other.ts', enabled: true })
    expect(result.current).toBeNull()
  })

  it('reports null for a file outside any repository', async () => {
    mockInvoke.mockRejectedValue('not a git repository')
    const { result } = renderHook(() => useGitFileContext('w', 'f/loose.txt', true))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('git_file_context', { workspaceId: 'w', path: 'f/loose.txt' }))
    await act(async () => {})
    expect(result.current).toBeNull()
  })
})
