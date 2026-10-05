/** @vitest-environment jsdom */
import { EditorView } from '@codemirror/view'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { installCodeMirrorShims } from '../../editor/__tests__/cmShims'
import { GitBranchDiffModal } from '../GitBranchDiffModal'
import { GitBranchFooter } from '../GitBranchFooter'
import { GitDiffViewer } from '../GitDiffViewer'
import { GitGraphSection } from '../GitGraphSection'
import { GitProjectSelector } from '../GitProjectSelector'
import { GitStashModal } from '../GitStashModal'
import type { GitBranchComparison, GitCommitSummary, GitStashEntry } from '../gitTypes'

const mockStashes: GitStashEntry[] = [
  { index: 0, name: 'stash@{0}', message: 'WIP on main: 1234abc feat', timestamp: '2 hours ago' },
  { index: 1, name: 'stash@{1}', message: 'WIP before rebase', timestamp: '1 day ago' },
]

const mockComparison: GitBranchComparison = {
  base_branch: 'main',
  target_branch: 'feature/diff',
  commits_ahead: [
    {
      id: 'abc123456789',
      short_id: 'abc1234',
      summary: 'feat: add jetbrains diff features',
      author_name: 'Developer',
      author_email: 'dev@example.com',
      timestamp: 1700000000,
      parents: ['parent1'],
    },
  ],
  commits_behind: [
    {
      id: 'def987654321',
      short_id: 'def9876',
      summary: 'fix: upstream fix',
      author_name: 'Lead',
      author_email: 'lead@example.com',
      timestamp: 1699990000,
      parents: ['parent0'],
    },
  ],
  files: [
    {
      path: 'src/lib.rs',
      staged: 'modified',
      unstaged: 'unmodified',
      is_conflicted: false,
    },
  ],
}

const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
  if (cmd === 'git_stash_list') return Promise.resolve(mockStashes)
  if (cmd === 'git_stash_save') return Promise.resolve('Saved working directory')
  if (cmd === 'git_stash_pop') return Promise.resolve('Dropped refs/stash@{0}')
  if (cmd === 'git_stash_apply') return Promise.resolve('Applied stash@{0}')
  if (cmd === 'git_stash_drop') return Promise.resolve('Dropped stash@{0}')
  if (cmd === 'git_compare_branches') return Promise.resolve(mockComparison)
  if (cmd === 'git_cherry_pick') return Promise.resolve('Cherry-pick succeeded')
  if (cmd === 'git_read_file') return Promise.resolve('line 1\nline 2\nline 3')
  if (cmd === 'git_write_file') return Promise.resolve(undefined)
  if (cmd === 'git_diff' || cmd === 'git_diff_branch') {
    return Promise.resolve({
      path: 'src/lib.rs',
      is_binary: false,
      hunks: [
        {
          header: '@@ -1,3 +1,3 @@',
          old_start: 1,
          old_lines: 3,
          new_start: 1,
          new_lines: 3,
          lines: [
            { line_type: 'context', old_lineno: 1, new_lineno: 1, content: 'line 1' },
            { line_type: 'addition', new_lineno: 2, content: '+ line 2 modified' },
          ],
        },
      ],
    })
  }
  return Promise.resolve(null)
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

describe('GitStashModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders stashes and allows pop and stash save', async () => {
    const onClose = vi.fn()
    const onRefresh = vi.fn()

    render(<GitStashModal cwd="/test/repo" onClose={onClose} onRefresh={onRefresh} />)

    await waitFor(() => {
      expect(screen.getByText('Git Stashes (2)')).toBeDefined()
      expect(screen.getByText('WIP on main: 1234abc feat')).toBeDefined()
    })

    const popButtons = screen.getAllByRole('button', { name: /pop/i })
    fireEvent.click(popButtons[0])

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('git_stash_pop', expect.objectContaining({ cwd: '/test/repo', index: 0 }))
      expect(onRefresh).toHaveBeenCalled()
    })
  })
})

describe('GitBranchDiffModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders branch comparison, switches tabs, and handles cherry-pick', async () => {
    const onClose = vi.fn()
    const onOpenFileDiff = vi.fn()

    render(
      <GitBranchDiffModal
        cwd="/test/repo"
        currentBranch="main"
        targetBranch="feature/diff"
        onClose={onClose}
        onOpenFileDiff={onOpenFileDiff}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'View diff for src/lib.rs' })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: 'View diff for src/lib.rs' }))
    expect(onOpenFileDiff).toHaveBeenCalledWith('src/lib.rs', 'feature/diff')

    const commitsTab = screen.getByRole('button', { name: /commits/i })
    fireEvent.click(commitsTab)

    await waitFor(() => {
      expect(screen.getByText('feat: add jetbrains diff features')).toBeDefined()
    })

    const cherryPickBtn = screen.getByRole('button', { name: /cherry-pick/i })
    fireEvent.click(cherryPickBtn)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('git_cherry_pick', expect.objectContaining({
        cwd: '/test/repo',
        commitId: 'abc123456789',
      }))
    })
  })
})

const workingCopyView = async () => {
  await waitFor(() => expect(document.querySelectorAll('.cm-content')).toHaveLength(2))
  const view = EditorView.findFromDOM(document.querySelectorAll('.cm-content')[1] as HTMLElement)
  if (!view) throw new Error('no working-copy editor')
  return view
}

describe('GitDiffViewer inline editing and view mode toggle', () => {
  beforeAll(installCodeMirrorShims)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders diff viewer and allows toggling view mode', async () => {
    const onClose = vi.fn()

    render(
      <GitDiffViewer
        cwd="/test/repo"
        filePath="src/lib.rs"
        staged={false}
        onClose={onClose}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Diff for src/lib.rs' })
    expect(within(dialog).getByTitle('src/lib.rs')).toHaveTextContent('lib.rs')
    await workingCopyView()

    const context = within(dialog).getByRole('group', { name: 'Diff context' })
    const fullFileBtn = within(context).getByRole('button', { name: /full file/i })
    const diffOnlyBtn = within(context).getByRole('button', { name: /changes only/i })
    expect(diffOnlyBtn).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(fullFileBtn)
    expect(fullFileBtn).toHaveAttribute('aria-pressed', 'true')
    expect(diffOnlyBtn).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(diffOnlyBtn)
    expect(diffOnlyBtn).toHaveAttribute('aria-pressed', 'true')
    expect(fullFileBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('allows inline editing in full file mode and saving', async () => {
    const onClose = vi.fn()

    render(
      <GitDiffViewer
        cwd="/test/repo"
        filePath="src/lib.rs"
        staged={false}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Diff for src/lib.rs' })).toBeInTheDocument()

    const fullFileBtn = screen.getByRole('button', { name: /full file/i })
    fireEvent.click(fullFileBtn)

    const view = await workingCopyView()
    const saveBtn = screen.getByRole('button', { name: /^save$/i })
    expect(saveBtn).toBeDisabled()
    expect(screen.queryByText('Unsaved')).toBeNull()
    act(() => view.dispatch({ changes: { from: 13, to: 13, insert: ' edited' } }))
    expect(saveBtn).not.toBeDisabled()
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('git_write_file', expect.objectContaining({
        cwd: '/test/repo',
        filePath: 'src/lib.rs',
        content: 'line 1\nline 2 edited\nline 3',
      }))
    })
    await waitFor(() => expect(screen.queryByText('Unsaved')).toBeNull())
    expect(await screen.findByRole('status')).toHaveTextContent('Saved successfully')
  })

  it('leaves keys the editor handled to the editor instead of navigating or closing', async () => {
    const onClose = vi.fn()
    const onSelectFile = vi.fn()
    render(
      <GitDiffViewer
        cwd="/test/repo"
        filePath="src/lib.rs"
        staged={false}
        allFiles={['README.md', 'src/lib.rs', 'src/main.rs']}
        onSelectFile={onSelectFile}
        onClose={onClose}
      />,
    )
    const view = await workingCopyView()

    // Ctrl+Arrow inside the editor moves by word; it must not switch files.
    fireEvent.keyDown(view.contentDOM, { key: 'ArrowRight', ctrlKey: true })
    expect(onSelectFile).not.toHaveBeenCalled()

    // An Escape the editor consumed (e.g. closing its search panel) must not close the diff.
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    consumed.preventDefault()
    act(() => {
      window.dispatchEvent(consumed)
    })
    expect(onClose).not.toHaveBeenCalled()

    // Outside the editor the shortcuts still work.
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true })
    expect(onSelectFile).toHaveBeenCalledWith('src/main.rs', false)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('Right click branch actions and GitGraphSection cherry pick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('supports right-click context menu on branch in footer', async () => {
    const onClick = vi.fn()
    render(
      <GitBranchFooter
        cwd="/test/repo"
        status={{
          repo_root: '/test/repo',
          branch: 'main',
          ahead: 0,
          behind: 0,
          is_detached: false,
          files: [],
          conflict_count: 0,
        }}
        onClick={onClick}
      />,
    )

    const branchBtn = screen.getByRole('button', { name: 'Current branch: main' })
    let notPrevented = true
    await act(async () => {
      notPrevented = fireEvent.contextMenu(branchBtn)
    })
    // The native context menu is suppressed in favor of the branch menu.
    expect(notPrevented).toBe(false)
    expect(onClick).toHaveBeenCalled()
  })

  it('renders ahead and behind counts as distinct push and pull chips', () => {
    render(
      <GitBranchFooter
        status={{
          repo_root: '/test/repo',
          branch: 'main',
          ahead: 2,
          behind: 1,
          is_detached: false,
          files: [],
          conflict_count: 0,
        }}
      />,
    )

    expect(screen.getByTitle('2 commits to push')).toHaveTextContent('2')
    expect(screen.getByTitle('1 commits to pull')).toHaveTextContent('1')
    expect(screen.queryByText(/[↑↓]/)).not.toBeInTheDocument()
  })

  it('supports right-click on branch button in GitProjectSelector', async () => {
    const onTogglePopup = vi.fn()
    render(
      <GitProjectSelector
        projects={[{ id: '1', name: 'proj', path: '/test/repo' }]}
        selectedPath="/test/repo"
        currentBranch="features/git"
        onSelectProject={vi.fn()}
        onToggleBranchPopup={onTogglePopup}
      />,
    )

    const branchBtn = screen.getByRole('button', { name: 'Current branch: features/git' })
    expect(fireEvent.contextMenu(branchBtn)).toBe(false)
    expect(onTogglePopup).toHaveBeenCalledTimes(1)
  })

  it('allows cherry picking commit from GitGraphSection', async () => {
    const commits: GitCommitSummary[] = [
      {
        id: '112233445566',
        short_id: '1122334',
        summary: 'feat: amazing commit',
        author_name: 'Developer',
        author_email: 'dev@test.com',
        timestamp: 1700000000,
        parents: [],
      },
    ]

    const onRefresh = vi.fn()
    render(
      <GitGraphSection
        cwd="/test/repo"
        commits={commits}
        loading={false}
        onRefresh={onRefresh}
      />,
    )

    // Select the commit
    const commitRow = screen.getByText('feat: amazing commit')
    fireEvent.click(commitRow)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cherry-pick/i })).toBeDefined()
    })

    const cherryBtn = screen.getByRole('button', { name: /cherry-pick/i })
    fireEvent.click(cherryBtn)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('git_cherry_pick', expect.objectContaining({
        cwd: '/test/repo',
        commitId: '112233445566',
      }))
      expect(onRefresh).toHaveBeenCalled()
    })
  })
})
