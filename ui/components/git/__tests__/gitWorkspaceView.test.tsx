/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { installCodeMirrorShims } from '../../editor/__tests__/cmShims'
import { GitWorkspaceView } from '../GitWorkspaceView'
import type { GitCommitSummary, GitFileDiff, GitRepoStatus } from '../gitTypes'

// The real diff editor mounts here and scrolls to the first change, which measures text ranges.
beforeAll(installCodeMirrorShims)

const mockStatus: GitRepoStatus = {
  repo_root: '/repo',
  branch: 'feature/omniterm-git',
  upstream: 'origin/feature/omniterm-git',
  ahead: 1,
  behind: 0,
  is_detached: false,
  conflict_count: 0,
  files: [
    { path: 'src/app.tsx', staged: 'modified', unstaged: 'unmodified', is_conflicted: false },
    { path: 'docs/git.md', staged: 'unmodified', unstaged: 'modified', is_conflicted: false },
  ],
}

const mockCommits: GitCommitSummary[] = [
  {
    id: 'abcdef1234567890abcdef1234567890abcdef12',
    short_id: 'abcdef1',
    summary: 'feat(git): add dedicated workspace view',
    author_name: 'OmniTerm Dev',
    author_email: 'dev@example.com',
    timestamp: 1700000000,
    parents: ['1234567'],
  },
]

const mockDiff: GitFileDiff = {
  path: 'src/app.tsx',
  is_binary: false,
  hunks: [
    {
      old_start: 1,
      old_lines: 1,
      new_start: 1,
      new_lines: 2,
      header: '@@ -1,1 +1,2 @@',
      lines: [
        { line_type: 'context', old_lineno: 1, new_lineno: 1, content: 'import React from "react"' },
        { line_type: 'addition', old_lineno: undefined, new_lineno: 2, content: 'import { GitWorkspaceView } from "./git"' },
      ],
    },
  ],
}

vi.mock('../../../gitAPI', () => ({
  createGitAPI: () => ({
    getStatus: vi.fn().mockResolvedValue(mockStatus),
    getLog: vi.fn().mockResolvedValue(mockCommits),
    getDiff: vi.fn().mockResolvedValue(mockDiff),
    getBranches: vi.fn().mockResolvedValue([]),
    listWorktrees: vi.fn().mockResolvedValue([]),
    fetch: vi.fn().mockResolvedValue('Fetched origin'),
    pull: vi.fn().mockResolvedValue('Already up to date'),
    push: vi.fn().mockResolvedValue('Everything up to date'),
    commit: vi.fn().mockResolvedValue('commit 1234567'),
    revert: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('import React from "react"\nimport { GitWorkspaceView } from "./git"\n'),
    readFileRevision: vi.fn().mockResolvedValue('import React from "react"\n'),
    writeFile: vi.fn().mockResolvedValue(undefined),
  }),
}))

describe('GitWorkspaceView', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders toolbar with view switcher and back button', async () => {
    const onClose = vi.fn()
    render(
      <GitWorkspaceView
        cwd="/repo"
        workspaces={[{ id: 'ws-1', name: 'OmniTerm', order: 0, pins: [], folders: [{ id: 'f-1', name: 'Repo', path: '/repo' }] }]}
        onClose={onClose}
      />,
    )

    const nav = screen.getByRole('navigation', { name: 'Git workspace views' })
    expect(screen.getByRole('button', { name: 'Terminal' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /^Changes & Diff/ })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Commit Graph' })).toBeInTheDocument()

    // Wait for async git data to populate
    await waitFor(() => {
      expect(screen.getByText('Local Changes')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'View staged diff for src/app.tsx' })).toHaveTextContent('app.tsx')
    expect(screen.getByRole('button', { name: 'View working tree diff for docs/git.md' })).toHaveTextContent('git.md')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('switches between Changes & Diff view and Git Graph partition', async () => {
    const onClose = vi.fn()
    render(
      <GitWorkspaceView
        cwd="/repo"
        workspaces={[{ id: 'ws-1', name: 'OmniTerm', order: 0, pins: [], folders: [{ id: 'f-1', name: 'Repo', path: '/repo' }] }]}
        onClose={onClose}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Local Changes')).toBeInTheDocument()
    })

    const nav = screen.getByRole('navigation', { name: 'Git workspace views' })
    const graphTab = within(nav).getByRole('button', { name: 'Commit Graph' })
    const changesTab = within(nav).getByRole('button', { name: /^Changes & Diff/ })
    expect(changesTab).toHaveAttribute('aria-current', 'page')

    // Switch to Commit Graph view
    await act(async () => {
      fireEvent.click(graphTab)
    })
    expect(localStorage.getItem('omniterm:git-active-tab')).toBe('graph')
    expect(graphTab).toHaveAttribute('aria-current', 'page')
    const graph = screen.getByRole('region', { name: 'Commit graph' })
    await waitFor(() => {
      expect(within(graph).getByRole('button', { name: /feat\(git\): add dedicated workspace view/ })).toBeInTheDocument()
    })
    expect(screen.queryByText('Local Changes')).not.toBeInTheDocument()

    // Switch back to Changes & Diff view
    await act(async () => {
      fireEvent.click(changesTab)
    })
    expect(localStorage.getItem('omniterm:git-active-tab')).toBe('changes')
    expect(changesTab).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Local Changes')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Commit graph' })).not.toBeInTheDocument()
  })

  it('respects gitGraphEnabled config to hide Git Graph tab', async () => {
    await act(async () => {
      render(
        <GitWorkspaceView
          cwd="/repo"
          gitGraphEnabled={false}
          workspaces={[{ id: 'ws-1', name: 'OmniTerm', order: 0, pins: [], folders: [{ id: 'f-1', name: 'Repo', path: '/repo' }] }]}
          onClose={vi.fn()}
        />,
      )
    })

    const nav = screen.getByRole('navigation', { name: 'Git workspace views' })
    expect(within(nav).getByRole('button', { name: /^Changes & Diff/ })).toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: 'Commit Graph' })).not.toBeInTheDocument()
  })
})
