/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitBranchCleanupDetail } from '../GitBranchCleanupDetail'
import { analyzeBranchForCleanup } from '../gitBranchCleanupUtils'
import type { GitBranchComparison, GitBranchInfo } from '../gitTypes'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('../GitBranchFileViewer', () => ({
  GitBranchFileViewer: ({ base, target, files }: { base: string; target: string; files: unknown[] }) => (
    <div data-testid="file-viewer">{`${base}..${target}:${files.length}`}</div>
  ),
}))

const branch = (overrides: Partial<GitBranchInfo> = {}): GitBranchInfo => ({
  name: 'feat/x',
  is_current: false,
  is_remote: false,
  ahead: 0,
  behind: 0,
  is_gone: false,
  ...overrides,
})

const commit = (id: string, summary: string) => ({
  id,
  short_id: id.slice(0, 7),
  summary,
  author_name: 'Dev',
  author_email: 'dev@example.com',
  timestamp: 1700000000,
  parents: [],
})

const comparison = (overrides: Partial<GitBranchComparison> = {}): GitBranchComparison => ({
  base_branch: 'master',
  target_branch: 'feat/x',
  commits_ahead: [],
  commits_behind: [commit('bbbbbbbbbb', 'upstream fix')],
  files: [{ path: 'a.ts', staged: 'modified', unstaged: 'unmodified', is_conflicted: false }],
  ...overrides,
})

async function renderDetail(info: GitBranchInfo, props: { currentBranch?: string; deleting?: boolean; defaultBranch?: string } = {}) {
  const onDeleteSingle = vi.fn()
  await act(async () => {
    render(
      <GitBranchCleanupDetail
        cwd="/repo"
        branch={info}
        defaultBranch={props.defaultBranch}
        analysis={analyzeBranchForCleanup(info, props.currentBranch)}
        deleting={props.deleting}
        onDeleteSingle={onDeleteSingle}
      />,
    )
  })
  return { onDeleteSingle }
}

describe('GitBranchCleanupDetail coverage', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(comparison())
  })

  it('defaults the base branch to master and shows fallbacks for missing metadata', async () => {
    await renderDetail(branch())
    expect(mockInvoke).toHaveBeenCalledWith('git_compare_branches', { cwd: '/repo', baseBranch: 'master', targetBranch: 'feat/x' })
    expect(screen.getByRole('heading', { name: 'Keep for now' })).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByText('No tracking branch')).toBeInTheDocument()
    expect(screen.getByText('No commit message available')).toBeInTheDocument()
    expect(screen.queryByText('· remote gone')).not.toBeInTheDocument()
    expect(screen.getByText('No unique commits relative to master.')).toBeInTheDocument()
    expect(screen.getByText('commits behind master').previousSibling).toHaveTextContent('1')
  })

  it('describes a high-confidence candidate with its metadata and unique commits', async () => {
    mockInvoke.mockResolvedValue(comparison({ commits_ahead: [commit('aaaaaaaaaa', 'wip: draft')] }))
    const info = branch({
      is_gone: true,
      upstream: 'origin/feat/x',
      last_commit_author: 'Alice',
      last_commit_message: 'feat: work',
    })
    const { onDeleteSingle } = await renderDetail(info, { defaultBranch: 'main' })
    expect(screen.getByRole('heading', { name: 'Cleanup candidate' })).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('· remote gone')).toBeInTheDocument()
    expect(screen.getByText('feat: work')).toBeInTheDocument()
    expect(screen.getByTitle('wip: draft')).toBeInTheDocument()
    expect(screen.getByText('aaaaaaa')).toBeInTheDocument()
    expect(screen.getByText('Compare with', { exact: false })).toHaveTextContent('Compare with main')

    fireEvent.click(screen.getByRole('button', { name: 'Review deletion' }))
    expect(onDeleteSingle).toHaveBeenCalledWith('feat/x')
  })

  it('hides deletion for protected branches', async () => {
    await renderDetail(branch({ name: 'feat/x' }), { currentBranch: 'feat/x' })
    expect(screen.getByRole('heading', { name: 'Protected branch' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review deletion' })).not.toBeInTheDocument()
  })

  it('disables single deletion while a deletion is running', async () => {
    await renderDetail(branch({ behind: 2 }), { deleting: true })
    expect(screen.getByRole('heading', { name: 'Cleanup candidate' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review deletion' })).toBeDisabled()
  })

  it('switches to file changes from the metrics shortcut and back to the overview', async () => {
    await renderDetail(branch())
    const filesTab = screen.getByRole('button', { name: /^File changes/ })
    expect(filesTab).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: /changed files/ }))
    expect(filesTab).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('file-viewer')).toHaveTextContent('master..feat/x:1')

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(screen.queryByTestId('file-viewer')).not.toBeInTheDocument()
  })

  it('shows loading states until the comparison resolves', async () => {
    let resolve: (value: GitBranchComparison) => void = () => undefined
    mockInvoke.mockReturnValue(new Promise<GitBranchComparison>((done) => { resolve = done }))
    await renderDetail(branch())
    expect(screen.getByLabelText('Loading comparison')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^File changes/ }))
    expect(screen.getByRole('status')).toHaveTextContent('Reading file differences…')

    await act(async () => {
      resolve(comparison())
    })
    expect(screen.queryByLabelText('Loading comparison')).not.toBeInTheDocument()
    expect(screen.getByTestId('file-viewer')).toBeInTheDocument()
  })

  it.each([
    ['bad revision', 'bad revision'],
    [new Error('nope'), 'Could not compare with base branch'],
  ])('reports comparison failures (%s) in both views', async (failure, message) => {
    mockInvoke.mockRejectedValue(failure)
    await renderDetail(branch())
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    fireEvent.click(screen.getByRole('button', { name: /^File changes/ }))
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByTestId('file-viewer')).not.toBeInTheDocument()
  })

  it('ignores a late comparison failure after the branch changed', async () => {
    const pending: Array<{ resolve: (value: GitBranchComparison) => void; reject: (reason: unknown) => void }> = []
    mockInvoke.mockImplementation(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }))
    const onDeleteSingle = vi.fn()
    const first = branch({ name: 'feat/first' })
    const second = branch({ name: 'feat/second' })
    let view: ReturnType<typeof render> | undefined
    await act(async () => {
      view = render(<GitBranchCleanupDetail cwd="/repo" branch={first} analysis={analyzeBranchForCleanup(first)} onDeleteSingle={onDeleteSingle} />)
    })
    await act(async () => {
      view?.rerender(<GitBranchCleanupDetail cwd="/repo" branch={second} analysis={analyzeBranchForCleanup(second)} onDeleteSingle={onDeleteSingle} />)
    })
    await act(async () => {
      pending[0].reject('stale failure')
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Loading comparison')).toBeInTheDocument()

    await act(async () => {
      pending[1].resolve(comparison({ commits_ahead: [commit('cccccccccc', 'second work')] }))
    })
    expect(screen.getByTitle('second work')).toBeInTheDocument()
  })

  it('ignores a late successful comparison after the branch changed', async () => {
    const pending: Array<(value: GitBranchComparison) => void> = []
    mockInvoke.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    const first = branch({ name: 'feat/first' })
    const second = branch({ name: 'feat/second' })
    let view: ReturnType<typeof render> | undefined
    await act(async () => {
      view = render(<GitBranchCleanupDetail cwd="/repo" branch={first} analysis={analyzeBranchForCleanup(first)} onDeleteSingle={vi.fn()} />)
    })
    await act(async () => {
      view?.rerender(<GitBranchCleanupDetail cwd="/repo" branch={second} analysis={analyzeBranchForCleanup(second)} onDeleteSingle={vi.fn()} />)
    })
    await act(async () => {
      pending[0](comparison({ commits_ahead: [commit('dddddddddd', 'first work')] }))
    })
    expect(screen.queryByTitle('first work')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Loading comparison')).toBeInTheDocument()
  })
})
