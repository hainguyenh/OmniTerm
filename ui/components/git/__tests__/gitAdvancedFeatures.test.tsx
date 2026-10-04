/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitBlameModal } from '../GitBlameModal'
import { GitBranchCompareModal } from '../GitBranchCompareModal'
import { GitContextMenu } from '../GitContextMenu'
import { GitDiffViewer } from '../GitDiffViewer'
import type { GitBlameLine, GitBranchInfo, GitFileDiff } from '../gitTypes'

const mockBlameData: GitBlameLine[] = [
  {
    line_no: 1,
    commit: 'a1b2c3d4e5f6',
    author: 'Alice',
    date: '2026-03-20',
    content: 'pub fn main() {',
  },
  {
    line_no: 2,
    commit: 'f6e5d4c3b2a1',
    author: 'Bob',
    date: '2026-03-21',
    content: '    println!("Hello OmniTerm");',
  },
]

const mockBranches: GitBranchInfo[] = [
  { name: 'main', is_current: true, is_remote: false, ahead: 0, behind: 0, is_gone: false },
  { name: 'feature/diff-fix', is_current: false, is_remote: false, ahead: 1, behind: 0, is_gone: false },
  { name: 'origin/main', is_current: false, is_remote: true, ahead: 0, behind: 0, is_gone: false },
]

const mockDiff: GitFileDiff = {
  path: 'src/main.rs',
  is_binary: false,
  hunks: [
    {
      header: '@@ -1,3 +1,3 @@',
      old_start: 1,
      old_lines: 3,
      new_start: 1,
      new_lines: 3,
      lines: [
        { line_type: 'context', old_lineno: 1, new_lineno: 1, content: 'fn main() {' },
        { line_type: 'deletion', old_lineno: 2, content: '- println!("old");' },
        { line_type: 'addition', new_lineno: 2, content: '+ println!("new");' },
        { line_type: 'context', old_lineno: 3, new_lineno: 3, content: '}' },
      ],
    },
  ],
}

const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
  if (cmd === 'git_blame') {
    return Promise.resolve(mockBlameData)
  }
  if (cmd === 'git_branches') {
    return Promise.resolve(mockBranches)
  }
  if (cmd === 'git_diff' || cmd === 'git_diff_branch') {
    return Promise.resolve(mockDiff)
  }
  if (cmd === 'git_read_file' || cmd === 'git_read_file_revision') {
    return Promise.resolve('fn main() {\n  println!("new");\n}\n')
  }
  return Promise.resolve(null)
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

describe('GitContextMenu', () => {
  it('renders context menu options and dispatches actions', () => {
    const onStage = vi.fn()
    const onUnstage = vi.fn()
    const onDiscard = vi.fn()
    const onDelete = vi.fn()
    const onBlame = vi.fn()
    const onCompareBranch = vi.fn()
    const onClose = vi.fn()

    const { rerender } = render(
      <GitContextMenu
        x={100}
        y={150}
        filePath="src/main.rs"
        isStaged={false}
        onStage={onStage}
        onUnstage={onUnstage}
        onDiscard={onDiscard}
        onDelete={onDelete}
        onBlame={onBlame}
        onCompareBranch={onCompareBranch}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('src/main.rs')).toBeInTheDocument()
    expect(screen.getByText('Stage')).toBeInTheDocument()
    expect(screen.getByText('Discard Changes')).toBeInTheDocument()
    expect(screen.getByText('Delete File')).toBeInTheDocument()
    expect(screen.getByText('Annotate (Blame)')).toBeInTheDocument()
    expect(screen.getByText('Compare with Branch...')).toBeInTheDocument()

    // Test stage click
    fireEvent.click(screen.getByText('Stage'))
    expect(onStage).toHaveBeenCalledWith('src/main.rs')
    expect(onClose).toHaveBeenCalled()

    // Re-render as staged
    rerender(
      <GitContextMenu
        x={100}
        y={150}
        filePath="src/main.rs"
        isStaged={true}
        onStage={onStage}
        onUnstage={onUnstage}
        onDiscard={onDiscard}
        onDelete={onDelete}
        onBlame={onBlame}
        onCompareBranch={onCompareBranch}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('Unstage')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Unstage'))
    expect(onUnstage).toHaveBeenCalledWith('src/main.rs')
  })
})

describe('GitBlameModal', () => {
  it('loads and displays git blame information with commit hash, author, and date', async () => {
    const onClose = vi.fn()
    render(<GitBlameModal cwd="/repo" filePath="src/main.rs" onClose={onClose} />)

    expect(screen.getByText(/Loading blame details/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })

    expect(screen.getByText('a1b2c3d4')).toBeInTheDocument()
    expect(screen.getByText('f6e5d4c3')).toBeInTheDocument()
    expect(screen.getByText('2026-03-20')).toBeInTheDocument()
    expect(screen.getByText('pub fn main() {')).toBeInTheDocument()

    // Test close button
    const closeBtn = screen.getByTitle(/Close/i)
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('GitBranchCompareModal', () => {
  it('loads branches, filters by search, and triggers onSelectBranch', async () => {
    const onClose = vi.fn()
    const onSelectBranch = vi.fn()

    render(
      <GitBranchCompareModal
        cwd="/repo"
        filePath="src/main.rs"
        currentBranch="main"
        onSelectBranch={onSelectBranch}
        onClose={onClose}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('main')).toBeInTheDocument()
      expect(screen.getByText('feature/diff-fix')).toBeInTheDocument()
      expect(screen.getByText('origin/main')).toBeInTheDocument()
    })

    // Search filter
    const searchInput = screen.getByPlaceholderText(/Filter branches/i)
    fireEvent.change(searchInput, { target: { value: 'feature' } })

    expect(screen.queryByText('origin/main')).not.toBeInTheDocument()
    expect(screen.getByText('feature/diff-fix')).toBeInTheDocument()

    // Select branch
    fireEvent.click(screen.getByText('feature/diff-fix'))
    expect(onSelectBranch).toHaveBeenCalledWith('feature/diff-fix')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('GitDiffViewer Enhanced', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders diff with staged vs working tree tabs and supports targetBranch comparison', async () => {
    const onSelectFile = vi.fn()
    const onClose = vi.fn()

    const { rerender } = render(
      <GitDiffViewer
        cwd="/repo"
        filePath="src/main.rs"
        staged={false}
        allFiles={[
          { path: 'src/main.rs', staged: false },
          { path: 'src/lib.rs', staged: true },
        ]}
        onSelectFile={onSelectFile}
        onClose={onClose}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Diff for src/main.rs' })
    expect(within(dialog).getByTitle('src/main.rs')).toHaveTextContent('main.rs')

    // Header tabs Staged vs Working Tree
    const versions = within(dialog).getByRole('group', { name: 'Diff version' })
    const stagedTab = within(versions).getByRole('button', { name: 'Staged' })
    const workingTreeTab = within(versions).getByRole('button', { name: 'Working tree' })
    expect(workingTreeTab).toHaveAttribute('aria-pressed', 'true')
    expect(stagedTab).toHaveAttribute('aria-pressed', 'false')

    // Switching to Staged tab
    fireEvent.click(stagedTab)
    expect(onSelectFile).toHaveBeenCalledWith('src/main.rs', true)

    // Next file navigation preserves staged flag from allFiles
    const nextBtn = within(dialog).getByRole('button', { name: 'Next file' })
    fireEvent.click(nextBtn)
    expect(onSelectFile).toHaveBeenCalledWith('src/lib.rs', true)

    // Comparing against a branch shows branch indicator
    act(() => {
      rerender(
        <GitDiffViewer
          cwd="/repo"
          filePath="src/main.rs"
          staged={false}
          targetBranch="feature/diff-fix"
          allFiles={[{ path: 'src/main.rs', staged: false }]}
          onSelectFile={onSelectFile}
          onClose={onClose}
        />,
      )
    })

    await waitFor(() => {
      expect(screen.getByText('Compare with feature/diff-fix')).toBeInTheDocument()
    })
    // A branch comparison has no staged/working-tree choice.
    expect(screen.queryByRole('group', { name: 'Diff version' })).not.toBeInTheDocument()
  })
})
