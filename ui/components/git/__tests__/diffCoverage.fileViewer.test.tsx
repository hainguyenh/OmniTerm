/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitBranchFileViewer } from '../GitBranchFileViewer'
import { GitBranchReviewEditor } from '../GitBranchReviewEditor'
import type { GitFileChange } from '../gitTypes'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('../../editor/DiffEditor', () => ({
  DiffEditor: (props: { original: string; modified: string; filePath: string; readOnly?: boolean; collapseUnchanged?: boolean }) => (
    <div data-testid="diff-editor" data-path={props.filePath} data-readonly={String(props.readOnly)} data-collapse={String(props.collapseUnchanged)}>
      <pre data-testid="original">{props.original}</pre>
      <pre data-testid="modified">{props.modified}</pre>
    </div>
  ),
}))

interface RevisionArgs {
  cwd: string
  filePath: string
  revision: string
}

const file = (path: string, staged: GitFileChange['staged'], unstaged: GitFileChange['unstaged'] = 'unmodified', origPath?: string): GitFileChange => ({
  path,
  orig_path: origPath,
  staged,
  unstaged,
  is_conflicted: false,
})

const flushPromises = () => new Promise<void>((done) => { setTimeout(done, 0) })

const revisionCalls = () => mockInvoke.mock.calls
  .filter(([cmd]) => cmd === 'git_read_file_revision')
  .map(([, args]) => {
    const { filePath, revision } = args as RevisionArgs
    return `${filePath}@${revision}`
  })

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((cmd: string, args: RevisionArgs) => {
    if (cmd === 'git_read_file_revision') return Promise.resolve(`${args.filePath} at ${args.revision}`)
    return Promise.resolve(null)
  })
})

describe('GitBranchFileViewer', () => {
  it('shows an empty state when the snapshots have no differing files', () => {
    render(<GitBranchFileViewer cwd="/repo" base="main" target="topic" files={[]} />)
    expect(screen.getByText('No file differences')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('loads both revisions of the first file into a read-only diff', async () => {
    render(<GitBranchFileViewer cwd="/repo" base="main" target="topic" files={[file('src/a.ts', 'modified'), file('src/b.ts', 'modified')]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading comparison')
    const editor = await screen.findByTestId('diff-editor')
    expect(editor).toHaveAttribute('data-path', 'src/a.ts')
    expect(editor).toHaveAttribute('data-readonly', 'true')
    expect(editor).toHaveAttribute('data-collapse', 'true')
    expect(screen.getByTestId('original')).toHaveTextContent('src/a.ts at main')
    expect(screen.getByTestId('modified')).toHaveTextContent('src/a.ts at topic')
    expect(screen.getByRole('combobox')).toHaveValue('src/a.ts')
    expect(screen.getAllByText('Read-only')).toHaveLength(2)
  })

  it('switches to the file chosen in the picker', async () => {
    render(<GitBranchFileViewer cwd="/repo" base="main" target="topic" files={[file('src/a.ts', 'modified'), file('src/b.ts', 'modified')]} />)
    await screen.findByTestId('diff-editor')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'src/b.ts' } })
    await waitFor(() => expect(screen.getByTestId('diff-editor')).toHaveAttribute('data-path', 'src/b.ts'))
    expect(screen.getByTestId('modified')).toHaveTextContent('src/b.ts at topic')
    expect(revisionCalls()).toContain('src/b.ts@main')
  })

  it('skips the base blob for an added file and the target blob for a deleted file', async () => {
    const { rerender } = render(<GitBranchFileViewer cwd="/repo" base="main" target="topic" files={[file('new.ts', 'added')]} />)
    await screen.findByTestId('diff-editor')
    expect(screen.getByTestId('original')).toBeEmptyDOMElement()
    expect(revisionCalls()).toEqual(['new.ts@topic'])

    mockInvoke.mockClear()
    rerender(<GitBranchFileViewer cwd="/repo" base="main" target="topic" files={[file('gone.ts', 'deleted')]} />)
    await waitFor(() => expect(screen.getByTestId('diff-editor')).toHaveAttribute('data-path', 'gone.ts'))
    expect(screen.getByTestId('modified')).toBeEmptyDOMElement()
    expect(revisionCalls()).toEqual(['gone.ts@main'])
  })

  it('uses the unstaged status when nothing is staged and reads renames from the original path', async () => {
    render(<GitBranchFileViewer cwd="/repo" base="main" target="topic" files={[file('new-name.ts', 'unmodified', 'added'), file('renamed.ts', 'renamed', 'unmodified', 'old.ts')]} />)
    await screen.findByTestId('diff-editor')
    expect(revisionCalls()).toEqual(['new-name.ts@topic'])

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'renamed.ts' } })
    await waitFor(() => expect(screen.getByTestId('original')).toHaveTextContent('old.ts at main'))
    expect(revisionCalls()).toContain('renamed.ts@topic')
  })

  it('shows Error and non-Error read failures as alerts', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('bad revision'))
    const { rerender } = render(<GitBranchFileViewer cwd="/repo" base="main" target="topic" files={[file('a.ts', 'modified')]} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('bad revision')
    expect(screen.queryByTestId('diff-editor')).toBeNull()

    mockInvoke.mockRejectedValueOnce('plain failure')
    rerender(<GitBranchFileViewer cwd="/repo" base="main" target="other" files={[file('a.ts', 'modified')]} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('plain failure'))
  })

  it('ignores results that arrive after the viewer unmounts', async () => {
    const pending: Array<(value: string) => void> = []
    mockInvoke.mockImplementation(() => new Promise<string>((done) => { pending.push(done) }))
    const { unmount } = render(<GitBranchFileViewer cwd="/repo" base="main" target="topic" files={[file('a.ts', 'modified')]} />)
    expect(pending).toHaveLength(2)
    unmount()
    pending.forEach((done) => done('late'))
    await flushPromises()
    expect(screen.queryByTestId('diff-editor')).toBeNull()
  })

  it('ignores failures that arrive after the viewer unmounts', async () => {
    const pending: Array<(reason: unknown) => void> = []
    mockInvoke.mockImplementation(() => new Promise<string>((_done, fail) => { pending.push(fail) }))
    const { unmount } = render(<GitBranchFileViewer cwd="/repo" base="main" target="topic" files={[file('a.ts', 'modified')]} />)
    unmount()
    pending.forEach((fail) => fail(new Error('late failure')))
    await flushPromises()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('GitBranchReviewEditor', () => {
  const handlers = () => ({ onForceDelete: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn() })

  it('uses the singular label and safe explanation for one branch', () => {
    const props = handlers()
    render(<GitBranchReviewEditor branches={['old']} forceDelete={false} busy={false} {...props} />)
    expect(screen.getByText('1 local branch selected for deletion')).toBeInTheDocument()
    expect(screen.getByText(/Git will refuse to delete branches/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review cleanup plan' })).toHaveFocus()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(props.onForceDelete).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: /Delete 1 branch/ }))
    expect(props.onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Back to viewer/ }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('warns about forced deletion and disables actions while busy', () => {
    const props = handlers()
    render(<GitBranchReviewEditor branches={['a', 'b']} forceDelete busy {...props} />)
    expect(screen.getByText('2 local branches selected for deletion')).toBeInTheDocument()
    expect(screen.getByText(/Unmerged work may be lost/)).toBeInTheDocument()
    expect(document.querySelector('.git-review-explanation')).toHaveClass('is-warning')
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: /Delete 2 branches/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Back to viewer/ })).toBeDisabled()
  })

  it('cannot confirm an empty plan', () => {
    render(<GitBranchReviewEditor branches={[]} forceDelete={false} busy={false} {...handlers()} />)
    expect(screen.getByRole('button', { name: /Delete 0 branches/ })).toBeDisabled()
  })
})
