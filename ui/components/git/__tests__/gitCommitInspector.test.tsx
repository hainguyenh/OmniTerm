/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GitCommitInspector } from '../GitCommitInspector'
import type { GitCommitDetails, GitCommitSummary } from '../gitTypes'

const dummyCommit: GitCommitSummary = {
  id: '0123456789abcdef0123456789abcdef01234567',
  short_id: '0123456',
  summary: 'feat: add git graph resizer',
  author_name: 'Test Author',
  author_email: 'author@example.com',
  timestamp: 1700000000,
  parents: ['fedcba9876543210fedcba9876543210fedcba98'],
}

const dummyDetails: GitCommitDetails = {
  commit: dummyCommit,
  full_message: 'feat: add git graph resizer\n\nDetailed commit message body here.',
  total_files: 3,
  total_additions: 42,
  total_deletions: 5,
  files: [
    {
      path: 'src/main.rs',
      status: 'modified',
      additions: 30,
      deletions: 2,
      is_binary: false,
    },
    {
      path: 'ui/app.tsx',
      status: 'added',
      additions: 12,
      deletions: 0,
      is_binary: false,
    },
    {
      path: 'assets/logo.png',
      status: 'renamed',
      old_path: 'assets/old_logo.png',
      additions: 0,
      deletions: 3,
      is_binary: true,
    },
  ],
}

describe('GitCommitInspector', () => {
  it('renders placeholder when no commit is selected', () => {
    render(<GitCommitInspector
      selected={null}
      details={null}
      loadingDetails={false}
      onClose={vi.fn()}
    />)

    expect(screen.getByText('Inspect a commit')).toBeInTheDocument()
    expect(screen.getByText(/Select a row to see its author/)).toBeInTheDocument()
  })

  it('renders commit metadata and message body', () => {
    const onClose = vi.fn()
    render(<GitCommitInspector
      selected={dummyCommit}
      details={dummyDetails}
      loadingDetails={false}
      onClose={onClose}
    />)

    expect(screen.getByText('0123456')).toBeInTheDocument()
    expect(screen.getByText('feat: add git graph resizer')).toBeInTheDocument()
    expect(screen.getByText('Test Author')).toBeInTheDocument()
    expect(screen.getByText('author@example.com')).toBeInTheDocument()
    expect(screen.getByText('Detailed commit message body here.')).toBeInTheDocument()
    expect(screen.getByText('fedcba987654')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close commit details' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders changed files with stats and status badges', () => {
    const onOpenFileDiff = vi.fn()
    render(<GitCommitInspector
      selected={dummyCommit}
      details={dummyDetails}
      loadingDetails={false}
      onClose={vi.fn()}
      onOpenFileDiff={onOpenFileDiff}
    />)

    expect(screen.getByText('FILES CHANGED (3)')).toBeInTheDocument()
    expect(screen.getByText('+42')).toBeInTheDocument()
    expect(screen.getByText('-5')).toBeInTheDocument()

    const fileList = screen.getByRole('list')
    expect(within(fileList).getByText('src/main.rs')).toBeInTheDocument()
    expect(within(fileList).getByText('ui/app.tsx')).toBeInTheDocument()
    expect(within(fileList).getByText('assets/logo.png')).toBeInTheDocument()
    expect(within(fileList).getByText(/assets\/old_logo\.png →/)).toBeInTheDocument()
    expect(within(fileList).getByText('bin')).toBeInTheDocument()

    // Click file item in file list
    fireEvent.click(within(fileList).getByText('src/main.rs'))
    expect(screen.getByRole('region', { name: 'Diff for src/main.rs' })).toBeInTheDocument()

    // Click full diff action in preview header
    fireEvent.click(screen.getByRole('button', { name: 'Open in full diff editor' }))
    expect(onOpenFileDiff).toHaveBeenCalledWith('src/main.rs', dummyCommit.id)
  })

  it('shows loading state when changed files are being fetched', () => {
    render(<GitCommitInspector
      selected={dummyCommit}
      details={null}
      loadingDetails={true}
      onClose={vi.fn()}
    />)

    expect(screen.getByText('Loading changed files…')).toBeInTheDocument()
  })

  it('triggers cherry-pick callback when repository cwd is present', () => {
    const onCherryPick = vi.fn()
    render(<GitCommitInspector
      cwd="/repo"
      selected={dummyCommit}
      details={dummyDetails}
      loadingDetails={false}
      onClose={vi.fn()}
      onCherryPick={onCherryPick}
    />)

    const button = screen.getByRole('button', { name: /Cherry-pick commit/ })
    fireEvent.click(button)
    expect(onCherryPick).toHaveBeenCalledWith(dummyCommit.id)
  })
})
