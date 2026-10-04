/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GitBranchFooter } from '../GitBranchFooter'
import { GitCommitSection } from '../GitCommitSection'
import { GitDiffViewer } from '../GitDiffViewer'
import { GitGraphSection } from '../GitGraphSection'
import type { GitCommitSummary, GitRepoStatus } from '../gitTypes'

const mockStatus: GitRepoStatus = {
  repo_root: '/repo',
  branch: 'main',
  upstream: 'origin/main',
  ahead: 2,
  behind: 1,
  is_detached: false,
  conflict_count: 1,
  files: [
    { path: 'src/main.rs', staged: 'modified', unstaged: 'unmodified', is_conflicted: false },
    { path: 'README.md', staged: 'unmodified', unstaged: 'added', is_conflicted: false },
    { path: 'conflict.txt', staged: 'conflicted', unstaged: 'conflicted', is_conflicted: true },
  ],
}

const mockCommits: GitCommitSummary[] = [
  {
    id: '1111222233334444555566667777888899990000',
    short_id: '1111222',
    summary: 'feat(git): add commit and graph support',
    author_name: 'OmniTerm Developer',
    author_email: 'dev@omniterm.local',
    timestamp: Math.floor(Date.now() / 1000) - 300,
    parents: ['0000111'],
  },
]

describe('GitCommitSection', () => {
  it('renders files, status badges, view toggle, and commit form', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined)
    const onRevert = vi.fn().mockResolvedValue(undefined)
    const onSelectFile = vi.fn()
    const onRefresh = vi.fn()

    render(
      <GitCommitSection
        status={mockStatus}
        loading={false}
        selectedFile={null}
        onRefresh={onRefresh}
        onSelectFile={onSelectFile}
        onCommit={onCommit}
        onRevert={onRevert}
      />,
    )

    expect(screen.getByText('Local Changes')).toBeInTheDocument()
    expect(screen.getByText('(3)')).toBeInTheDocument()

    // In tree view (default), folder `src` and file `main.rs` are rendered
    expect(screen.getByText('main.rs')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.getAllByText('conflict.txt')[0]).toBeInTheDocument()

    // File selection in tree view
    fireEvent.click(screen.getByText('main.rs'))
    expect(onSelectFile).toHaveBeenCalledWith('src/main.rs', true)

    // Toggle to list view
    const viewToggleBtn = screen.getByLabelText(/Switch to List view/i)
    fireEvent.click(viewToggleBtn)
    expect(screen.getByText('src/main.rs')).toBeInTheDocument()

    // Type commit message and check 72-char indicator
    const textarea = screen.getByPlaceholderText(/Commit message/)
    act(() => {
      fireEvent.change(textarea, { target: { value: 'fix(core): improve git diff calculation' } })
    })
    expect(screen.getByText('39/72')).toBeInTheDocument()

    // Commit button
    const commitBtn = screen.getByRole('button', { name: /Commit/i })
    expect(commitBtn).toBeDisabled() // no files selected yet

    // Select all files
    const selectAllBtn = screen.getByTitle('Select all')
    act(() => {
      fireEvent.click(selectAllBtn)
    })

    expect(commitBtn).toBeEnabled()
    await act(async () => {
      fireEvent.click(commitBtn)
    })
    expect(onCommit).toHaveBeenCalledWith('fix(core): improve git diff calculation', false)
  })

  it('handles empty changes state gracefully', () => {
    render(
      <GitCommitSection
        status={{ ...mockStatus, files: [] }}
        loading={false}
        selectedFile={null}
        onRefresh={vi.fn()}
        onSelectFile={vi.fn()}
        onCommit={vi.fn()}
        onRevert={vi.fn()}
      />,
    )
    expect(screen.getByText('No local changes')).toBeInTheDocument()
  })
})

describe('GitGraphSection', () => {
  it('renders commit list with short hash, summary, and author, and supports commit inspection', () => {
    const onSelect = vi.fn()
    render(
      <GitGraphSection
        commits={mockCommits}
        loading={false}
        onRefresh={vi.fn()}
        onSelectCommit={onSelect}
      />,
    )

    expect(screen.getByRole('region', { name: 'Commit graph' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Commit Graph' })).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /feat\(git\): add commit and graph support/ })
    expect(row).toHaveTextContent('1111222')
    expect(row).toHaveTextContent('OmniTerm Developer')
    expect(row).toHaveAttribute('aria-pressed', 'false')

    // Clicking commit shows inspection drawer
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith(mockCommits[0])
    expect(row).toHaveAttribute('aria-pressed', 'true')
    const details = screen.getByRole('complementary', { name: 'Commit details' })
    expect(within(details).getByRole('heading', { name: 'feat(git): add commit and graph support' })).toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Copy full commit SHA' })).toBeInTheDocument()
  })
})

describe('GitBranchFooter', () => {
  it('renders branch name and ahead/behind counters without conflict or clean status', () => {
    const onClick = vi.fn()
    render(<GitBranchFooter status={mockStatus} onClick={onClick} />)

    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('↑2 ↓1')).toBeInTheDocument()
    expect(screen.queryByText('1 conflict')).toBeNull()
    expect(screen.queryByText('· clean')).toBeNull()

    fireEvent.click(screen.getByText('main'))
    expect(onClick).toHaveBeenCalled()
  })
})

describe('GitDiffViewer', () => {
  it('renders in a dedicated view layer dialog with header, close button, and navigation', async () => {
    const onClose = vi.fn()
    const onSelectFile = vi.fn()

    await act(async () => {
      render(
        <GitDiffViewer
          cwd="/repo"
          filePath="src/main.rs"
          staged={false}
          allFiles={['src/main.rs', 'README.md']}
          onSelectFile={onSelectFile}
          onClose={onClose}
        />,
      )
    })

    const dialog = screen.getByRole('dialog', { name: 'Diff for src/main.rs' })
    expect(within(dialog).getByTitle('src/main.rs')).toHaveTextContent('main.rs')
    const navigation = within(dialog).getByRole('group', { name: 'File navigation' })
    expect(navigation).toHaveTextContent('1 / 2')
    expect(within(navigation).getByRole('button', { name: 'Previous file' })).toBeDisabled()

    // Next file navigation
    fireEvent.click(within(navigation).getByRole('button', { name: 'Next file' }))
    expect(onSelectFile).toHaveBeenCalledWith('README.md', false)

    // Close button
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close diff' }))
    expect(onClose).toHaveBeenCalled()
  })
})
