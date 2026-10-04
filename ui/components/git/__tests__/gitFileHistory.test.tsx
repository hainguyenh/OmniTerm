/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitFileHistoryModal } from '../GitFileHistoryModal'
import { historySides, moveSelection } from '../gitFileHistoryUtils'
import type { GitCommitSummary, GitFileHistoryEntry } from '../gitTypes'

vi.mock('../../editor/DiffEditor', () => ({
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="diff">{`${original}=>${modified}`}</div>
  ),
}))

const commit = (id: string, summary: string, parents: string[]): GitCommitSummary => ({
  id, short_id: id.slice(0, 7), summary, author_name: 'Dev', author_email: 'dev@example.test',
  timestamp: 1_786_000_000, parents,
})

const HISTORY: GitFileHistoryEntry[] = [
  { commit: commit('ccccccc3', 'edit after rename', ['bbbbbbb2']), path: 'src/new.ts' },
  { commit: commit('bbbbbbb2', 'rename', ['aaaaaaa1']), path: 'src/new.ts' },
  { commit: commit('aaaaaaa1', 'create', []), path: 'src/old.ts' },
]

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))

function defaultInvoke(cmd: string, args: Record<string, string>) {
  if (cmd === 'git_file_history') return Promise.resolve(HISTORY)
  if (cmd === 'git_read_file') return Promise.resolve('working')
  if (cmd === 'git_read_file_revision') {
    if (args.revision === 'aaaaaaa1^') return Promise.reject(new Error('no parent'))
    return Promise.resolve(`${args.revision}:${args.filePath}`)
  }
  return Promise.resolve(null)
}

describe('historySides', () => {
  it('diffs a commit against its parent at the path the file had before', () => {
    expect(historySides(HISTORY, 1, 'commit', 'src/new.ts')).toEqual({
      before: { kind: 'revision', revision: 'bbbbbbb2^', path: 'src/old.ts', label: 'aaaaaaa · src/old.ts' },
      after: { kind: 'revision', revision: 'bbbbbbb2', path: 'src/new.ts', label: 'bbbbbbb · src/new.ts' },
    })
    expect(historySides(HISTORY, 2, 'commit', 'src/new.ts')?.before).toEqual({
      kind: 'empty', label: 'Root commit · file did not exist',
    })
  })

  it('compares a version with the working copy, and has nothing for a missing row', () => {
    expect(historySides(HISTORY, 2, 'working', 'src/new.ts')).toEqual({
      before: { kind: 'revision', revision: 'aaaaaaa1', path: 'src/old.ts', label: 'aaaaaaa · src/old.ts' },
      after: { kind: 'working', path: 'src/new.ts', label: 'Working copy · src/new.ts' },
    })
    expect(historySides(HISTORY, 3, 'commit', 'src/new.ts')).toBeNull()
  })

  it('clamps keyboard movement to the list', () => {
    expect(moveSelection(0, -1, 3)).toBe(0)
    expect(moveSelection(1, 1, 3)).toBe(2)
    expect(moveSelection(2, 1, 3)).toBe(2)
    expect(moveSelection(0, 1, 0)).toBe(0)
  })
})

describe('GitFileHistoryModal', () => {
  beforeEach(() => { mockInvoke.mockImplementation(defaultInvoke) })
  afterEach(() => vi.clearAllMocks())

  it('lists the commits and shows the selected commit against its parent', async () => {
    render(<GitFileHistoryModal cwd="D:/repo" filePath="src/new.ts" onClose={vi.fn()} />)
    expect(await screen.findByRole('option', { name: /edit after rename/ })).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledWith('git_file_history', {
      cwd: 'D:/repo', filePath: 'src/new.ts', startLine: null, endLine: null, limit: null,
    })
    expect(screen.getByText('File History:')).toBeInTheDocument()
    expect(screen.getByText('3 commit(s)')).toBeInTheDocument()
    // The rename is visible on the commit made under the old name.
    expect(screen.getByText('as src/old.ts')).toBeInTheDocument()
    expect(await screen.findByTestId('diff')).toHaveTextContent('ccccccc3^:src/new.ts=>ccccccc3:src/new.ts')

    fireEvent.click(screen.getAllByRole('option')[1])
    await waitFor(() => expect(screen.getByTestId('diff')).toHaveTextContent('bbbbbbb2^:src/old.ts=>bbbbbbb2:src/new.ts'))
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    // A root commit's parent side reads as empty, so the whole file shows as added.
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Commits' }), { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByTestId('diff')).toHaveTextContent('=>aaaaaaa1:src/old.ts'))
  })

  it('compares the selected version with the working copy and honours the full-file toggle', async () => {
    render(<GitFileHistoryModal cwd="D:/repo" filePath="src/new.ts" onClose={vi.fn()} />)
    await screen.findByTestId('diff')
    fireEvent.click(screen.getByRole('button', { name: 'Compare with working copy' }))
    await waitFor(() => expect(screen.getByTestId('diff')).toHaveTextContent('ccccccc3:src/new.ts=>working'))
    expect(mockInvoke).toHaveBeenCalledWith('git_read_file', { cwd: 'D:/repo', filePath: 'src/new.ts' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Full file' }))
    expect(screen.getByRole('checkbox', { name: 'Full file' })).toBeChecked()
  })

  it('requests a line range and labels the dialog as a selection history', async () => {
    render(<GitFileHistoryModal cwd="D:/repo" filePath="src/new.ts" range={{ start: 2, end: 4 }} onClose={vi.fn()} />)
    expect(await screen.findByText('Selection History:')).toBeInTheDocument()
    expect(screen.getByText('Lines 2–4')).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledWith('git_file_history', {
      cwd: 'D:/repo', filePath: 'src/new.ts', startLine: 2, endLine: 4, limit: null,
    })
  })

  it('shows git errors, empty histories and identical versions', async () => {
    mockInvoke.mockImplementation((cmd: string) => (
      cmd === 'git_file_history' ? Promise.reject(new Error('fatal: file has only 3 lines')) : Promise.resolve('')
    ))
    const { unmount } = render(<GitFileHistoryModal cwd="D:/repo" filePath="a.ts" range={{ start: 9, end: 9 }} onClose={vi.fn()} />)
    expect(await screen.findByText('fatal: file has only 3 lines')).toBeInTheDocument()
    unmount()

    mockInvoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'git_file_history' ? [] : ''))
    const empty = render(<GitFileHistoryModal cwd="D:/repo" filePath="a.ts" onClose={vi.fn()} />)
    expect(await screen.findByText('No commits found for this file.')).toBeInTheDocument()
    empty.unmount()

    mockInvoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'git_file_history' ? [HISTORY[0]] : 'same'))
    render(<GitFileHistoryModal cwd="D:/repo" filePath="src/new.ts" onClose={vi.fn()} />)
    expect(await screen.findByText('No content changes between these versions.')).toBeInTheDocument()
  })

  it('reports a working copy that cannot be read', async () => {
    mockInvoke.mockImplementation((cmd: string, args: Record<string, string>) => (
      cmd === 'git_read_file' ? Promise.reject('file is gone') : defaultInvoke(cmd, args)
    ))
    render(<GitFileHistoryModal cwd="D:/repo" filePath="src/new.ts" onClose={vi.fn()} />)
    await screen.findByTestId('diff')
    fireEvent.click(screen.getByRole('button', { name: 'Compare with working copy' }))
    expect(await screen.findByText('file is gone')).toBeInTheDocument()
  })

  it('copies the commit hash and closes on Escape, the close button or the backdrop', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const onClose = vi.fn()
    render(<GitFileHistoryModal cwd="D:/repo" filePath="src/new.ts" onClose={onClose} />)
    await screen.findByTestId('diff')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ccccccc' })) })
    expect(writeText).toHaveBeenCalledWith('ccccccc3')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close history' }))
    const dialog = screen.getByRole('dialog', { name: 'Git history: src/new.ts' })
    fireEvent.click(within(dialog).getByText('File History:'))
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
