/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitGraphSection } from '../GitGraphSection'
import type { GitCommitSummary } from '../gitTypes'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

const nowSec = () => Math.floor(Date.now() / 1000)

const commit = (id: string, overrides: Partial<GitCommitSummary> = {}): GitCommitSummary => ({
  id,
  short_id: id.slice(0, 7),
  summary: `summary ${id}`,
  author_name: 'Dev',
  author_email: 'dev@example.com',
  timestamp: nowSec() - 10,
  parents: [],
  ...overrides,
})

const writeText = vi.fn()

beforeEach(() => {
  mockInvoke.mockReset()
  writeText.mockReset()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})

afterEach(() => {
  vi.useRealTimers()
})

const row = (summary: string) => {
  const button = screen.getByText(summary, { selector: '.git-history-message strong' }).closest('button')
  if (!button) throw new Error(`no row for ${summary}`)
  return button
}

describe('GitGraphSection coverage', () => {
  it('formats commit ages from seconds up to calendar dates', () => {
    const now = nowSec()
    const old = now - 90 * 86_400
    render(<GitGraphSection
      commits={[
        commit('aaaaaaa1', { summary: 'zero', timestamp: 0 }),
        commit('aaaaaaa2', { summary: 'fresh', timestamp: now - 5 }),
        commit('aaaaaaa3', { summary: 'minutes', timestamp: now - 5 * 60 }),
        commit('aaaaaaa4', { summary: 'hours', timestamp: now - 3 * 3600 }),
        commit('aaaaaaa5', { summary: 'days', timestamp: now - 4 * 86_400 }),
        commit('aaaaaaa6', { summary: 'old', timestamp: old }),
      ]}
      loading={false}
      onRefresh={vi.fn()}
    />)
    const time = (summary: string) => row(summary).querySelector('.git-history-time')?.textContent
    expect(time('zero')).toBe('')
    expect(time('fresh')).toBe('just now')
    expect(time('minutes')).toBe('5m ago')
    expect(time('hours')).toBe('3h ago')
    expect(time('days')).toBe('4d ago')
    expect(time('old')).toBe(new Date(old * 1000).toLocaleDateString())
    expect(within(row('zero')).getByText('Latest')).toBeInTheDocument()
    expect(within(row('fresh')).queryByText('Latest')).toBeNull()
  })

  it('shows loading and empty history states', () => {
    const { rerender } = render(<GitGraphSection commits={[]} loading onRefresh={vi.fn()} />)
    expect(screen.getByText('Loading history…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh commit history' })).toBeDisabled()
    expect(document.querySelector('.git-history-graph')).toBeNull()
    rerender(<GitGraphSection commits={[]} loading={false} onRefresh={vi.fn()} />)
    expect(screen.getByText('No commits found')).toBeInTheDocument()
    expect(screen.getByText('0 commits loaded')).toBeInTheDocument()
  })

  it('mutes non-matching rows, reports matches, and shows an empty search state', () => {
    render(<GitGraphSection
      commits={[commit('1111111', { summary: 'Fix parser' }), commit('2222222', { summary: 'Add docs', author_name: 'Zoe' })]}
      loading={false}
      onRefresh={vi.fn()}
    />)
    const search = screen.getByRole('searchbox', { name: 'Search commit history' })
    fireEvent.change(search, { target: { value: '  ZOE ' } })
    expect(row('Add docs')).not.toHaveClass('is-muted')
    expect(row('Fix parser')).toHaveClass('is-muted')
    expect(screen.getByText('2 commits loaded · 1 matching')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'missing' } })
    expect(screen.getByText('No matching commits')).toBeInTheDocument()
    expect(document.querySelector('.git-history-graph')).toBeNull()
  })

  it('toggles commit details, marks merges, and lists parents', () => {
    const onSelectCommit = vi.fn()
    const merge = commit('mergecommit', { summary: 'Merge topic', parents: ['parentone12345', 'parenttwo67890'] })
    render(<GitGraphSection commits={[merge, commit('root000', { summary: 'Root' })]} loading={false} onRefresh={vi.fn()} onSelectCommit={onSelectCommit} />)
    expect(row('Merge topic').querySelector('.git-history-merge')).not.toBeNull()
    expect(row('Root').querySelector('.git-history-merge')).toBeNull()
    expect(screen.getByText('Inspect a commit')).toBeInTheDocument()

    fireEvent.click(row('Merge topic'))
    expect(onSelectCommit).toHaveBeenCalledWith(merge)
    expect(row('Merge topic')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('parentone123')).toBeInTheDocument()
    expect(screen.getByText('parenttwo678')).toBeInTheDocument()
    expect(document.querySelector('.git-graph-halo')).not.toBeNull()
    // Without a repository path there is nothing to cherry-pick into.
    expect(screen.queryByRole('button', { name: /Cherry-pick commit/ })).toBeNull()

    fireEvent.click(row('Merge topic'))
    expect(screen.getByText('Inspect a commit')).toBeInTheDocument()

    fireEvent.contextMenu(row('Root'))
    expect(screen.getByText('Root commit')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close commit details' }))
    expect(screen.getByText('Inspect a commit')).toBeInTheDocument()
  })

  it('copies the full SHA and briefly shows a check mark', async () => {
    writeText.mockResolvedValue(undefined)
    render(<GitGraphSection commits={[commit('fullsha123456')]} loading={false} onRefresh={vi.fn()} />)
    fireEvent.click(row('summary fullsha123456'))
    const copy = screen.getByRole('button', { name: 'Copy full commit SHA' })
    fireEvent.click(copy)
    await waitFor(() => expect(copy.querySelector('.lucide-check')).not.toBeNull())
    expect(writeText).toHaveBeenCalledWith('fullsha123456')
  })

  it('keeps the copy icon when the clipboard rejects', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<GitGraphSection commits={[commit('fullsha123456')]} loading={false} onRefresh={vi.fn()} />)
    fireEvent.click(row('summary fullsha123456'))
    const copy = screen.getByRole('button', { name: 'Copy full commit SHA' })
    fireEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    await Promise.resolve()
    expect(copy.querySelector('.lucide-copy')).not.toBeNull()
  })

  it('cherry-picks with a default notice, refreshes, and dismisses the notice', async () => {
    mockInvoke.mockResolvedValue('')
    const onRefresh = vi.fn()
    const refresh = vi.fn()
    window.addEventListener('omniterm:git-refresh', refresh)
    render(<GitGraphSection cwd="/repo" commits={[commit('abcdef9876')]} loading={false} onRefresh={onRefresh} />)
    fireEvent.click(row('summary abcdef9876'))
    fireEvent.click(screen.getByRole('button', { name: /Cherry-pick commit/ }))
    expect(await screen.findByText('Cherry-pick of abcdef9 succeeded')).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledWith('git_cherry_pick', { cwd: '/repo', commitId: 'abcdef9876' })
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss commit notice' }))
    expect(screen.queryByText(/succeeded/)).toBeNull()
    window.removeEventListener('omniterm:git-refresh', refresh)
  })

  it('shows Git output on success and the error on failure', async () => {
    mockInvoke.mockResolvedValueOnce('Applied cleanly')
    const onRefresh = vi.fn()
    render(<GitGraphSection cwd="/repo" commits={[commit('abcdef9876')]} loading={false} onRefresh={onRefresh} />)
    fireEvent.click(row('summary abcdef9876'))
    const pick = screen.getByRole('button', { name: /Cherry-pick commit/ })
    fireEvent.click(pick)
    expect(await screen.findByText('Applied cleanly')).toBeInTheDocument()

    mockInvoke.mockRejectedValueOnce('conflict in a.ts')
    fireEvent.click(pick)
    expect(await screen.findByText('Cherry-pick failed: conflict in a.ts')).toBeInTheDocument()
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(pick).toBeEnabled()
  })

  it('ignores a second cherry-pick while one is running', async () => {
    let finish: (value: string) => void = () => undefined
    mockInvoke.mockImplementation(() => new Promise<string>((done) => { finish = done }))
    render(<GitGraphSection cwd="/repo" commits={[commit('abcdef9876')]} loading={false} onRefresh={vi.fn()} />)
    fireEvent.click(row('summary abcdef9876'))
    const pick = screen.getByRole('button', { name: /Cherry-pick commit/ })
    fireEvent.click(pick)
    await waitFor(() => expect(pick).toBeDisabled())
    expect(pick.querySelector('.animate-spin')).not.toBeNull()
    // A keyboard/programmatic activation of the disabled button must not start another pick.
    pick.removeAttribute('disabled')
    fireEvent.click(pick)
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    finish('done')
    expect(await screen.findByText('done')).toBeInTheDocument()
  })
})
