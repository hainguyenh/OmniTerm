/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitCommitForm } from '../GitCommitForm'
import { GitCommitSection } from '../GitCommitSection'
import { GitBranchTreeView } from '../GitBranchTreeView'
import { GitFileRow } from '../GitFileRow'
import { buildBranchTree } from '../gitBranchTreeUtils'
import type { GitFileChange, GitRepoStatus } from '../gitTypes'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const file: GitFileChange = {
  path: 'src/main.ts',
  staged: 'unmodified',
  unstaged: 'modified',
  is_conflicted: false,
}
const status: GitRepoStatus = {
  repo_root: '/repo',
  branch: 'main',
  ahead: 0,
  behind: 0,
  is_detached: false,
  conflict_count: 0,
  files: [file],
}

describe('Git usability', () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined)
    localStorage.clear()
  })

  it('separates file selection, checkbox selection, and staging actions', () => {
    const onSelect = vi.fn()
    const onToggleCheck = vi.fn()
    const onToggleStage = vi.fn()
    render(
      <GitFileRow
        file={file}
        displayName="main.ts"
        isChecked={false}
        isSelected={false}
        isStaged={false}
        onSelect={onSelect}
        onToggleCheck={onToggleCheck}
        onToggleStage={onToggleStage}
        onContextMenu={vi.fn()}
      />,
    )
    expect(screen.getByText('Modified')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stage src/main.ts' }))
    expect(onToggleStage).toHaveBeenCalledWith('src/main.ts', false)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Check main.ts' }))
    expect(onToggleCheck).toHaveBeenCalledWith('src/main.ts', expect.anything())
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'View working tree diff for src/main.ts' }))
    expect(onSelect).toHaveBeenCalledWith('src/main.ts', false)
  })

  it('carries a one-letter status code for a narrow changes pane', () => {
    render(
      <GitFileRow
        file={{ ...file, unstaged: 'untracked' }}
        displayName="main.ts"
        isChecked={false}
        isSelected={false}
        isStaged={false}
        onSelect={vi.fn()}
        onToggleCheck={vi.fn()}
        onToggleStage={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    )
    const badge = screen.getByTitle('Untracked')
    expect(badge.querySelector('.git-status-long')).toHaveTextContent('Untracked')
    const short = badge.querySelector('.git-status-short')
    expect(short).toHaveTextContent('U')
    expect(short).toHaveAttribute('aria-hidden', 'true')
    // The stage button keeps its accessible name when only its + icon shows.
    expect(screen.getByRole('button', { name: 'Stage src/main.ts' })).toHaveTextContent('Stage')
  })

  it('labels conflicts and offers unstage for a staged file', () => {
    const onToggleStage = vi.fn()
    render(
      <GitFileRow
        file={{ ...file, staged: 'added', is_conflicted: true }}
        displayName="main.ts"
        isChecked
        isSelected
        isStaged
        onSelect={vi.fn()}
        onToggleCheck={vi.fn()}
        onToggleStage={onToggleStage}
        onContextMenu={vi.fn()}
      />,
    )
    expect(screen.getByText('Conflict')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Uncheck main.ts' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Unstage src/main.ts' }))
    expect(onToggleStage).toHaveBeenCalledWith('src/main.ts', true)
  })

  function renderChanges() {
    const onRefresh = vi.fn()
    render(
      <GitCommitSection
        status={status}
        cwd="/repo"
        loading={false}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onRefresh={onRefresh}
        onCommit={vi.fn()}
        onRevert={vi.fn()}
      />,
    )
    return onRefresh
  }

  it('exposes folder and change group disclosure state on real buttons', () => {
    renderChanges()
    const folder = screen.getByRole('button', { name: 'Collapse folder src' })
    expect(folder).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(folder)
    expect(screen.getByRole('button', { name: 'Expand folder src' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('main.ts')).not.toBeInTheDocument()
    const group = screen.getByRole('button', { name: /^Changes/ })
    fireEvent.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'false')
  })

  it('stages a file directly from its visible row action', async () => {
    const onRefresh = renderChanges()
    fireEvent.click(screen.getByRole('button', { name: 'Stage src/main.ts' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git_stage', { cwd: '/repo', paths: ['src/main.ts'] }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
  })

  it('exposes branch folders and branch actions as keyboard focusable buttons', () => {
    const branch = { name: 'feature/ui', is_current: false, is_remote: false, ahead: 0, behind: 0, is_gone: false }
    const onSelectBranch = vi.fn()
    render(
      <GitBranchTreeView
        nodes={buildBranchTree([branch])}
        currentBranch="main"
        selectedBranch={null}
        onSelectBranch={onSelectBranch}
        onCheckout={vi.fn()}
        onMerge={vi.fn()}
        onRebase={vi.fn()}
        onCompare={vi.fn()}
        onNewBranchFrom={vi.fn()}
      />,
    )
    const folder = screen.getByRole('button', { name: 'Collapse branch folder feature' })
    fireEvent.click(folder)
    expect(screen.queryByRole('button', { name: 'Branch feature/ui' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand branch folder feature' }))
    fireEvent.click(screen.getByRole('button', { name: 'Branch feature/ui' }))
    expect(onSelectBranch).toHaveBeenCalledWith(branch)
  })

  it('shows stage failures and allows retry without refreshing', async () => {
    invoke.mockRejectedValueOnce(new Error('Index is locked'))
    const onRefresh = renderChanges()
    const stage = screen.getByRole('button', { name: 'Stage src/main.ts' })
    fireEvent.click(stage)
    expect(await screen.findByRole('alert')).toHaveTextContent('Index is locked')
    expect(onRefresh).not.toHaveBeenCalled()
    expect(stage).toBeEnabled()
    fireEvent.click(stage)
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps commit shortcut consistent with the disabled commit button', () => {
    const onSubmit = vi.fn()
    const props = {
      message: '', amend: false, committing: false, canCommit: false,
      onChangeMessage: vi.fn(), onChangeAmend: vi.fn(), onSubmit,
    }
    const { rerender } = render(<GitCommitForm {...props} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Commit message' }), { key: 'Enter', ctrlKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    rerender(<GitCommitForm {...props} message="Update UI" canCommit />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Commit message' }), { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})
