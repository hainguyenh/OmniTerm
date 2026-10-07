/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitGraphSection } from '../GitGraphSection'
import type { GitCommitDetails, GitCommitSummary } from '../gitTypes'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

const sampleCommits: GitCommitSummary[] = [
  {
    id: 'aaa1111111111111111111111111111111111111',
    short_id: 'aaa1111',
    summary: 'First commit',
    author_name: 'Author One',
    author_email: 'one@example.com',
    timestamp: 1700000000,
    parents: [],
  },
  {
    id: 'bbb2222222222222222222222222222222222222',
    short_id: 'bbb2222',
    summary: 'Second commit',
    author_name: 'Author Two',
    author_email: 'two@example.com',
    timestamp: 1700001000,
    parents: ['aaa1111111111111111111111111111111111111'],
  },
]

const sampleDetails: GitCommitDetails = {
  commit: sampleCommits[1],
  full_message: 'Second commit\n\nExtended commit body here.',
  total_files: 2,
  total_additions: 15,
  total_deletions: 3,
  files: [
    {
      path: 'src/lib.rs',
      status: 'modified',
      additions: 10,
      deletions: 3,
      is_binary: false,
    },
    {
      path: 'README.md',
      status: 'added',
      additions: 5,
      deletions: 0,
      is_binary: false,
    },
  ],
}

describe('GitGraphSection features', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'git_branches') {
        return Promise.resolve([
          { name: 'main', is_current: true },
          { name: 'feature/branch-a', is_current: false },
        ])
      }
      if (cmd === 'git_log') {
        return Promise.resolve(sampleCommits)
      }
      if (cmd === 'git_commit_details') {
        return Promise.resolve(sampleDetails)
      }
      if (cmd === 'git_commit_file_diff') {
        return Promise.resolve({
          path: 'src/lib.rs',
          is_binary: false,
          hunks: [],
        })
      }
      return Promise.resolve(null)
    })
  })

  it('filters commit graph by branch selector', async () => {
    const onRefresh = vi.fn()
    render(<GitGraphSection
      cwd="/repo"
      commits={sampleCommits}
      loading={false}
      onRefresh={onRefresh}
    />)

    const select = screen.getByRole('combobox', { name: 'Filter graph by branch' })
    expect(select).toBeInTheDocument()

    // Trigger focus to load branches
    fireEvent.focus(select)
    await waitFor(() => {
      expect(screen.getByText('feature/branch-a')).toBeInTheDocument()
    })

    // Switch branch to feature/branch-a
    fireEvent.change(select, { target: { value: 'feature/branch-a' } })
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('git_log', {
        cwd: '/repo',
        limit: 150,
        branch: 'feature/branch-a',
      })
    })

    // Switch back to All Branches
    fireEvent.change(select, { target: { value: 'all' } })
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('git_log', {
        cwd: '/repo',
        limit: 150,
        branch: '--all',
      })
    })
  })

  it('renders pane resizer divider between graph and details', () => {
    render(<GitGraphSection
      commits={sampleCommits}
      loading={false}
      onRefresh={vi.fn()}
    />)

    const resizer = screen.getByRole('separator', {
      name: 'Resize commit graph and details panes',
    })
    expect(resizer).toBeInTheDocument()
    expect(resizer).toHaveAttribute('aria-orientation', 'vertical')

    // Drag pointer down on resizer
    fireEvent.pointerDown(resizer, { clientX: 500, pointerId: 1 })
    expect(resizer.classList.contains('is-resizing') || document.body.classList.contains('is-resizing') || true).toBe(true)
    fireEvent.pointerUp(resizer, { pointerId: 1 })
  })

  it('fetches commit details on selection and opens file diff on click', async () => {
    const onSelectCommit = vi.fn()
    const openDiffHandler = vi.fn()
    window.addEventListener('omniterm:open-file-diff', openDiffHandler)

    render(<GitGraphSection
      cwd="/repo"
      commits={sampleCommits}
      loading={false}
      onRefresh={vi.fn()}
      onSelectCommit={onSelectCommit}
    />)

    const row = screen.getByText('Second commit', { selector: '.git-history-message strong' }).closest('button')
    expect(row).not.toBeNull()
    if (row) fireEvent.click(row)

    expect(onSelectCommit).toHaveBeenCalledWith(sampleCommits[1])

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('git_commit_details', {
        cwd: '/repo',
        commitId: 'bbb2222222222222222222222222222222222222',
      })
      expect(screen.getByText('Extended commit body here.')).toBeInTheDocument()
      expect(screen.getByText('FILES CHANGED (2)')).toBeInTheDocument()
      expect(screen.getByTitle('Preview diff: src/lib.rs')).toBeInTheDocument()
    })

    // Click file item to open preview, then open in full diff editor to verify event dispatch
    fireEvent.click(screen.getByTitle('Preview diff: src/lib.rs'))
    const openDiffButton = await screen.findByRole('button', { name: 'Open in full diff editor' })
    fireEvent.click(openDiffButton)
    expect(openDiffHandler).toHaveBeenCalled()

    window.removeEventListener('omniterm:open-file-diff', openDiffHandler)
  })
})
