/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitCommitDiffPreview } from '../GitCommitDiffPreview'
import type { GitCommitFileChange, GitFileDiff } from '../gitTypes'

const mockGetCommitFileDiff = vi.fn()

vi.mock('../../../gitAPI', () => ({
  createGitAPI: () => ({
    getCommitFileDiff: mockGetCommitFileDiff,
  }),
}))

const dummyFile: GitCommitFileChange = {
  path: 'src/main.rs',
  status: 'modified',
  additions: 3,
  deletions: 1,
  is_binary: false,
}

const dummyDiff: GitFileDiff = {
  path: 'src/main.rs',
  is_binary: false,
  hunks: [
    {
      header: '@@ -1,3 +1,5 @@',
      old_start: 1,
      old_lines: 3,
      new_start: 1,
      new_lines: 5,
      lines: [
        { line_type: 'context', content: 'fn main() {', old_lineno: 1, new_lineno: 1 },
        { line_type: 'deletion', content: '    println!("old");', old_lineno: 2 },
        { line_type: 'addition', content: '    println!("new");', new_lineno: 2 },
        { line_type: 'addition', content: '    println!("added");', new_lineno: 3 },
        { line_type: 'context', content: '}', old_lineno: 3, new_lineno: 4 },
      ],
    },
  ],
}

describe('GitCommitDiffPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially and then displays diff hunks', async () => {
    mockGetCommitFileDiff.mockResolvedValueOnce(dummyDiff)

    render(
      <GitCommitDiffPreview
        cwd="/repo"
        commitId="abcdef123456"
        file={dummyFile}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Loading file diff…')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('@@ -1,3 +1,5 @@')).toBeInTheDocument()
    })

    expect(screen.getByText('println!("new");')).toBeInTheDocument()
    expect(screen.getByText('println!("old");')).toBeInTheDocument()
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
  })

  it('renders binary file badge if file is binary', async () => {
    const binaryFile: GitCommitFileChange = {
      ...dummyFile,
      is_binary: true,
      path: 'logo.png',
    }
    mockGetCommitFileDiff.mockResolvedValueOnce({
      path: 'logo.png',
      is_binary: true,
      hunks: [],
    })

    render(
      <GitCommitDiffPreview
        cwd="/repo"
        commitId="abcdef123456"
        file={binaryFile}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Binary file cannot be previewed')).toBeInTheDocument()
    })
  })

  it('handles error during fetch', async () => {
    mockGetCommitFileDiff.mockRejectedValueOnce(new Error('Git error'))

    render(
      <GitCommitDiffPreview
        cwd="/repo"
        commitId="abcdef123456"
        file={dummyFile}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/Failed to load diff: Git error/)).toBeInTheDocument()
    })
  })

  it('calls onClose and onOpenFullDiff callbacks', async () => {
    mockGetCommitFileDiff.mockResolvedValueOnce(dummyDiff)
    const onClose = vi.fn()
    const onOpenFullDiff = vi.fn()

    render(
      <GitCommitDiffPreview
        cwd="/repo"
        commitId="abcdef123456"
        file={dummyFile}
        onClose={onClose}
        onOpenFullDiff={onOpenFullDiff}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('@@ -1,3 +1,5 @@')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close diff preview' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open in full diff editor' }))
    expect(onOpenFullDiff).toHaveBeenCalledWith('src/main.rs', 'abcdef123456')
  })
})
