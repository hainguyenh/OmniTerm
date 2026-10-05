/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitBlameModal } from '../GitBlameModal'
import { GitBranchCompareModal } from '../GitBranchCompareModal'
import { GitBranchDiffModal } from '../GitBranchDiffModal'
import type { GitBranchComparison, GitBranchInfo, GitCommitSummary, GitFileChange } from '../gitTypes'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

const flushPromises = () => new Promise<void>((done) => { setTimeout(done, 0) })

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const commit = (id: string, summary: string): GitCommitSummary => ({
  id,
  short_id: id.slice(0, 7),
  summary,
  author_name: 'Dev',
  author_email: 'dev@example.com',
  timestamp: 1_700_000_000,
  parents: [],
})

const change = (path: string, staged: GitFileChange['staged']): GitFileChange => ({
  path,
  staged,
  unstaged: 'unmodified',
  is_conflicted: false,
})

beforeEach(() => {
  mockInvoke.mockReset()
})

describe('GitBlameModal branches', () => {
  it('shows an Error rejection message', async () => {
    mockInvoke.mockRejectedValue(new Error('not tracked'))
    render(<GitBlameModal cwd="/repo" filePath="a.ts" onClose={vi.fn()} />)
    expect(await screen.findByText('not tracked')).toBeInTheDocument()
    expect(screen.queryByText(/lines\)/)).toBeNull()
  })

  it('shows a non-Error rejection as text', async () => {
    mockInvoke.mockRejectedValue('blame exploded')
    render(<GitBlameModal cwd="/repo" filePath="a.ts" onClose={vi.fn()} />)
    expect(await screen.findByText('blame exploded')).toBeInTheDocument()
  })

  it('shows an empty state when Git returns no lines', async () => {
    mockInvoke.mockResolvedValue([])
    render(<GitBlameModal cwd="/repo" filePath="a.ts" onClose={vi.fn()} />)
    expect(await screen.findByText('No blame information available')).toBeInTheDocument()
  })

  it('counts lines, keeps blank lines visible, and closes on Escape or backdrop only', async () => {
    mockInvoke.mockResolvedValue([
      { line_no: 1, commit: '0123456789ab', author: 'Ann', date: '2026-01-01', content: '' },
      { line_no: 2, commit: 'ba9876543210', author: 'Ben', date: '2026-01-02', content: 'code' },
    ])
    const onClose = vi.fn()
    render(<GitBlameModal cwd="/repo" filePath="a.ts" onClose={onClose} />)
    expect(await screen.findByText('(2 lines)')).toBeInTheDocument()
    const firstContent = screen.getAllByRole('row')[0].querySelectorAll('td')[4]
    expect(firstContent.textContent).toBe(' ')
    expect(mockInvoke).toHaveBeenCalledWith('git_blame', { cwd: '/repo', filePath: 'a.ts' })

    fireEvent.click(screen.getByText('Ann'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('drops results and failures that arrive after unmount', async () => {
    const success = deferred<unknown>()
    mockInvoke.mockReturnValueOnce(success.promise)
    const first = render(<GitBlameModal cwd="/repo" filePath="a.ts" onClose={vi.fn()} />)
    first.unmount()
    success.resolve([{ line_no: 1, commit: 'x', author: 'Late', date: '', content: 'x' }])

    const failure = deferred<unknown>()
    mockInvoke.mockReturnValueOnce(failure.promise)
    const second = render(<GitBlameModal cwd="/repo" filePath="b.ts" onClose={vi.fn()} />)
    second.unmount()
    failure.reject(new Error('late'))
    await flushPromises()
    expect(screen.queryByText('Late')).toBeNull()
    expect(screen.queryByText('late')).toBeNull()
  })
})

describe('GitBranchCompareModal branches', () => {
  const branches: GitBranchInfo[] = [
    { name: 'main', is_current: false, is_remote: false, ahead: 0, behind: 0, is_gone: false },
    { name: 'checked-out', is_current: true, is_remote: false, ahead: 0, behind: 0, is_gone: false },
    { name: 'origin/Feature', is_current: false, is_remote: true, ahead: 0, behind: 0, is_gone: false },
  ]

  it('marks the explicit and the checked-out branch as current and flags remotes', async () => {
    mockInvoke.mockResolvedValue(branches)
    render(<GitBranchCompareModal cwd="/repo" filePath="a.ts" currentBranch="main" onSelectBranch={vi.fn()} onClose={vi.fn()} />)
    await screen.findByText('origin/Feature')
    expect(screen.getAllByText('current')).toHaveLength(2)
    expect(screen.getAllByText('remote')).toHaveLength(1)
    expect(screen.getByText('origin/Feature').closest('button')).not.toHaveClass('font-semibold')
  })

  it('filters case-insensitively and shows an empty state', async () => {
    mockInvoke.mockResolvedValue(branches)
    render(<GitBranchCompareModal cwd="/repo" filePath="a.ts" onSelectBranch={vi.fn()} onClose={vi.fn()} />)
    await screen.findByText('main')
    expect(screen.getAllByText('current')).toHaveLength(1)
    const input = screen.getByPlaceholderText('Filter branches...')
    fireEvent.change(input, { target: { value: '  FEATURE ' } })
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toContain('origin/Featureremote')
    expect(screen.queryByText('main')).toBeNull()
    fireEvent.change(input, { target: { value: 'nothing' } })
    expect(screen.getByText('No matching branches found')).toBeInTheDocument()
  })

  it('stops loading with no branches when the request fails', async () => {
    mockInvoke.mockRejectedValue(new Error('no repo'))
    render(<GitBranchCompareModal cwd="/repo" filePath="a.ts" onSelectBranch={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('No matching branches found')).toBeInTheDocument()
  })

  it('closes on Escape and backdrop clicks but not inner clicks', async () => {
    mockInvoke.mockResolvedValue([])
    const onClose = vi.fn()
    render(<GitBranchCompareModal cwd="/repo" filePath="a.ts" onSelectBranch={vi.fn()} onClose={onClose} />)
    await screen.findByText('No matching branches found')
    fireEvent.click(screen.getByText('Compare with Branch'))
    fireEvent.keyDown(window, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('ignores branch results and failures after unmount', async () => {
    const success = deferred<unknown>()
    mockInvoke.mockReturnValueOnce(success.promise)
    render(<GitBranchCompareModal cwd="/repo" filePath="a.ts" onSelectBranch={vi.fn()} onClose={vi.fn()} />).unmount()
    success.resolve(branches)
    const failure = deferred<unknown>()
    mockInvoke.mockReturnValueOnce(failure.promise)
    render(<GitBranchCompareModal cwd="/repo" filePath="a.ts" onSelectBranch={vi.fn()} onClose={vi.fn()} />).unmount()
    failure.reject(new Error('late'))
    await flushPromises()
    expect(screen.queryByText('main')).toBeNull()
  })
})

describe('GitBranchDiffModal branches', () => {
  const comparison = (overrides: Partial<GitBranchComparison> = {}): GitBranchComparison => ({
    base_branch: 'main',
    target_branch: 'topic',
    commits_ahead: [],
    commits_behind: [],
    files: [],
    ...overrides,
  })

  const renderModal = () => {
    const onClose = vi.fn()
    const onOpenFileDiff = vi.fn()
    render(<GitBranchDiffModal cwd="/repo" currentBranch="main" targetBranch="topic" onClose={onClose} onOpenFileDiff={onOpenFileDiff} />)
    return { onClose, onOpenFileDiff }
  }

  it('labels added, deleted, renamed, and modified files', async () => {
    mockInvoke.mockResolvedValue(comparison({
      files: [change('a.ts', 'added'), change('d.ts', 'deleted'), change('r.ts', 'renamed'), change('m.ts', 'modified')],
    }))
    const { onOpenFileDiff } = renderModal()
    await screen.findByText('a.ts')
    const label = (path: string) => screen.getByText(path).nextElementSibling
    expect(label('a.ts')).toHaveTextContent('A')
    expect(label('a.ts')).toHaveClass('git-status-added')
    expect(label('d.ts')).toHaveTextContent('D')
    expect(label('d.ts')).toHaveClass('git-status-deleted')
    expect(label('r.ts')).toHaveTextContent('R')
    expect(label('r.ts')).toHaveClass('git-status-renamed')
    expect(label('m.ts')).toHaveTextContent('M')
    expect(label('m.ts')).toHaveClass('git-status-modified')
    expect(screen.getByText('4 file(s) changed')).toBeInTheDocument()
    fireEvent.click(screen.getByText('d.ts'))
    expect(onOpenFileDiff).toHaveBeenCalledWith('d.ts', 'topic')
  })

  it('reports a failed comparison and shows the empty file state', async () => {
    mockInvoke.mockRejectedValue('bad ref')
    renderModal()
    expect(await screen.findByText('Comparison failed: bad ref')).toBeInTheDocument()
    expect(screen.getByText('No differences found between main and topic')).toBeInTheDocument()
    expect(screen.queryByText(/file\(s\) changed/)).toBeNull()
  })

  it('swaps the comparison direction and reloads', async () => {
    mockInvoke.mockResolvedValue(comparison())
    renderModal()
    await screen.findByText('No differences found between main and topic')
    fireEvent.click(screen.getByTitle('Swap branch comparison direction'))
    expect(await screen.findByText('No differences found between topic and main')).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenLastCalledWith('git_compare_branches', { cwd: '/repo', baseBranch: 'topic', targetBranch: 'main' })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Compare topic with main')
  })

  it('still diffs a file against the other branch after a swap, not the checked-out one', async () => {
    mockInvoke.mockResolvedValue(comparison({ files: [change('src/a.ts', 'modified')] }))
    const { onOpenFileDiff } = renderModal()
    fireEvent.click(await screen.findByTitle('Swap branch comparison direction'))
    await screen.findByRole('dialog', { name: 'Compare topic with main' })
    fireEvent.click(await screen.findByRole('button', { name: 'View diff for src/a.ts' }))
    expect(onOpenFileDiff).toHaveBeenCalledWith('src/a.ts', 'topic')
  })

  it('stacks above the branch popovers that open it', async () => {
    mockInvoke.mockResolvedValue(comparison())
    renderModal()
    await screen.findByText(/No differences found/)
    expect(screen.getByRole('dialog')).toHaveClass('z-[10000]')
  })

  it('shows no commits ahead and hides the behind section when both are empty', async () => {
    mockInvoke.mockResolvedValue(comparison())
    renderModal()
    await screen.findByText(/No differences found/)
    fireEvent.click(screen.getByText('Commits (0 ahead, 0 behind)'))
    expect(screen.getByText('No commits ahead')).toBeInTheDocument()
    expect(screen.queryByText(/Commits in main \(not in topic\)/)).toBeNull()
    fireEvent.click(screen.getByText('Files Changed (0)'))
    expect(screen.getByText(/No differences found/)).toBeInTheDocument()
  })

  it('uses a default notice when cherry-pick returns no output and reports failures', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'git_compare_branches') return Promise.resolve(comparison({ commits_ahead: [commit('abcdef123456', 'feat: one')] }))
      if (cmd === 'git_cherry_pick') return Promise.resolve('')
      return Promise.resolve(null)
    })
    const refresh = vi.fn()
    window.addEventListener('omniterm:git-refresh', refresh)
    renderModal()
    await screen.findByText(/No differences found/)
    fireEvent.click(screen.getByText(/Commits \(1 ahead/))
    fireEvent.click(screen.getByRole('button', { name: /Cherry-pick/ }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    // Regression: the post-pick reload used to clear the success notice the instant it was set.
    expect(screen.getByText('Cherry-pick of abcdef1 succeeded')).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledWith('git_cherry_pick', { cwd: '/repo', commitId: 'abcdef123456' })

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'git_cherry_pick') return Promise.reject(new Error('conflict'))
      return Promise.resolve(comparison({ commits_ahead: [commit('abcdef123456', 'feat: one')] }))
    })
    fireEvent.click(screen.getByRole('button', { name: /Cherry-pick/ }))
    expect(await screen.findByText('Cherry-pick failed: Error: conflict')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cherry-pick/ })).toBeEnabled()
    window.removeEventListener('omniterm:git-refresh', refresh)
  })

  it('closes on Escape and backdrop clicks only', async () => {
    mockInvoke.mockResolvedValue(comparison())
    const { onClose } = renderModal()
    await screen.findByText(/No differences found/)
    fireEvent.click(screen.getByText(/No differences found/))
    fireEvent.keyDown(window, { key: 'x' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
