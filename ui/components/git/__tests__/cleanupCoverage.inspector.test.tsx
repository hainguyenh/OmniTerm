/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GitBranchCleanupList } from '../GitBranchCleanupList'
import { GitBranchContextMenu } from '../GitBranchContextMenu'
import { GitBranchDeleteConfirmDialog } from '../GitBranchDeleteConfirmDialog'
import { GitBranchInspector } from '../GitBranchInspector'
import { analyzeBranchForCleanup } from '../gitBranchCleanupUtils'
import type { GitBranchInfo } from '../gitTypes'

const branch = (overrides: Partial<GitBranchInfo> = {}): GitBranchInfo => ({
  name: 'feat/x',
  is_current: false,
  is_remote: false,
  ahead: 0,
  behind: 0,
  is_gone: false,
  ...overrides,
})

const tools = {
  onRename: vi.fn().mockResolvedValue(null),
  onSetUpstream: vi.fn().mockResolvedValue(null),
  onAddWorktree: vi.fn().mockResolvedValue(null),
}

function renderInspector(info: GitBranchInfo | null, currentBranch?: string, busy = false) {
  const onUpdate = vi.fn()
  render(
    <GitBranchInspector
      branch={info}
      currentBranch={currentBranch}
      busy={busy}
      remoteBranches={['origin/main']}
      tools={tools}
      onUpdate={onUpdate}
      onCheckout={vi.fn()}
      onMerge={vi.fn()}
      onRebase={vi.fn()}
      onCompare={vi.fn()}
      onNewBranchFrom={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  return { onUpdate }
}

const syncStatus = () => screen.getByText('Sync status').nextElementSibling
const tracking = () => screen.getByText('Tracking').nextElementSibling

describe('GitBranchInspector coverage', () => {
  it('shows guidance when no branch is selected', () => {
    renderInspector(null)
    expect(screen.getByRole('heading', { name: 'Your branches, in focus' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Selected branch details' })).not.toBeInTheDocument()
  })

  it('describes an untracked local branch and offers an in-place update from HEAD', () => {
    const info = branch()
    const { onUpdate } = renderInspector(info)
    expect(screen.getByText('LOCAL BRANCH')).toBeInTheDocument()
    expect(tracking()).toHaveTextContent('No upstream')
    expect(syncStatus()).toHaveTextContent('Not tracked')
    expect(screen.getByText('Commit details unavailable')).toBeInTheDocument()
    expect(screen.getByText('STAY ON HEAD')).toBeInTheDocument()
    expect(screen.queryByText('Checked out')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Update branch/ }))
    expect(onUpdate).toHaveBeenCalledWith(info)
  })

  it('reports divergence and the last author for a tracked branch', () => {
    renderInspector(branch({ upstream: 'origin/feat/x', ahead: 2, behind: 0, last_commit_author: 'Alice', last_commit_message: 'feat: y' }), 'main', true)
    expect(tracking()).toHaveTextContent('origin/feat/x')
    expect(syncStatus()).toHaveTextContent('2 ahead · 0 behind')
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('feat: y')).toBeInTheDocument()
    expect(screen.getByText('STAY ON main')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Update branch/ })).toBeDisabled()
  })

  it('reports a behind-only tracking state', () => {
    renderInspector(branch({ upstream: 'origin/feat/x', behind: 3 }))
    expect(syncStatus()).toHaveTextContent('0 ahead · 3 behind')
  })

  it('reports an up-to-date branch', () => {
    renderInspector(branch({ upstream: 'origin/feat/x' }))
    expect(syncStatus()).toHaveTextContent('Up to date')
  })

  it('reports a removed upstream', () => {
    renderInspector(branch({ upstream: 'origin/feat/x', is_gone: true }))
    expect(syncStatus()).toHaveTextContent('Upstream removed')
  })

  it('marks the checked-out branch and hides the in-place update', () => {
    renderInspector(branch({ name: 'dev' }), 'dev')
    expect(screen.getByText('Checked out')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Update branch/ })).not.toBeInTheDocument()
  })

  it('describes a remote branch without update actions', () => {
    renderInspector(branch({ name: 'origin/feat/x', is_remote: true }))
    expect(screen.getByText('REMOTE BRANCH')).toBeInTheDocument()
    expect(tracking()).toHaveTextContent('Remote reference')
    expect(screen.queryByRole('button', { name: /Update branch/ })).not.toBeInTheDocument()
  })
})

describe('GitBranchCleanupList coverage', () => {
  it('labels each branch by its strongest cleanup signal and reports interactions', () => {
    const analyses = [
      branch({ name: 'main' }),
      branch({ name: 'feat/merged', is_merged: true, is_gone: true }),
      branch({ name: 'feat/gone', is_gone: true }),
      branch({ name: 'feat/old', behind: 1 }),
    ].map((info) => analyzeBranchForCleanup(info))
    const onInspect = vi.fn()
    const onSelect = vi.fn()
    render(
      <GitBranchCleanupList analyses={analyses} selected={new Set(['feat/gone'])} inspecting="feat/gone" onInspect={onInspect} onSelect={onSelect} />,
    )
    const rowFor = (name: string) => screen.getByRole('button', { name: new RegExp(name) })
    expect(rowFor('^main')).toHaveTextContent('Protected')
    expect(rowFor('feat/merged')).toHaveTextContent('Merged')
    expect(rowFor('feat/gone')).toHaveTextContent('Remote gone')
    expect(rowFor('feat/old')).toHaveTextContent('Inactive')
    expect(rowFor('feat/gone')).toHaveAttribute('aria-pressed', 'true')
    expect(rowFor('feat/old')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('checkbox', { name: 'Select feat/gone' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select main' })).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select feat/old' }))
    expect(onSelect).toHaveBeenCalledWith('feat/old')
    fireEvent.click(rowFor('feat/old'))
    expect(onInspect).toHaveBeenCalledWith('feat/old')
  })
})

describe('GitBranchDeleteConfirmDialog coverage', () => {
  const props = {
    selectedBranches: ['feat/a', 'feat/b'],
    forceDelete: false,
    onForceDeleteChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders nothing while closed', () => {
    const { container } = render(<GitBranchDeleteConfirmDialog open={false} {...props} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('defaults to an idle plan editor when open', () => {
    render(<GitBranchDeleteConfirmDialog open {...props} />)
    expect(screen.getByRole('button', { name: 'Delete 2 branches' })).toBeEnabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(props.onForceDeleteChange).toHaveBeenCalledWith(true)
  })
})

describe('GitBranchContextMenu coverage', () => {
  it('stays hidden without a container and only closes from the backdrop itself', () => {
    const onClose = vi.fn()
    render(
      <GitBranchContextMenu title="feat/x" point={{ x: 1, y: 1 }} containerRef={{ current: null }} onClose={onClose}>
        <button type="button">Checkout</button>
      </GitBranchContextMenu>,
    )
    const dialog = screen.getByLabelText('Actions for feat/x')
    expect(dialog.style.visibility).toBe('hidden')

    fireEvent.contextMenu(screen.getByText('Checkout'))
    expect(onClose).not.toHaveBeenCalled()
    const backdrop = dialog.parentElement
    if (!backdrop) throw new Error('context menu backdrop missing')
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
