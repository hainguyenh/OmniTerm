/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitCommitSection } from '../GitCommitSection'
import type { GitFileChange, GitRepoStatus } from '../gitTypes'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

vi.mock('../GitBlameModal', () => ({
  GitBlameModal: (props: { filePath: string; onClose: () => void }) => (
    <div data-testid="blame" data-path={props.filePath}>
      <button type="button" onClick={props.onClose}>stub close blame</button>
    </div>
  ),
}))

vi.mock('../GitBranchCompareModal', () => ({
  GitBranchCompareModal: (props: {
    filePath: string
    currentBranch?: string
    onSelectBranch: (branch: string) => void
    onClose: () => void
  }) => (
    <div data-testid="compare" data-path={props.filePath} data-branch={props.currentBranch ?? ''}>
      <button type="button" onClick={() => props.onSelectBranch('dev')}>stub pick branch</button>
      <button type="button" onClick={props.onClose}>stub close compare</button>
    </div>
  ),
}))

vi.mock('../GitStashModal', () => ({
  GitStashModal: (props: { cwd: string; onClose: () => void; onRefresh: () => void }) => (
    <div data-testid="stash" data-cwd={props.cwd}>
      <button type="button" onClick={props.onRefresh}>stub stash refresh</button>
      <button type="button" onClick={props.onClose}>stub close stash</button>
    </div>
  ),
}))

const change = (path: string, staged: GitFileChange['staged'], unstaged: GitFileChange['unstaged']): GitFileChange => ({
  path,
  staged,
  unstaged,
  is_conflicted: false,
})

const STATUS: GitRepoStatus = {
  repo_root: '/repo',
  branch: 'main',
  ahead: 0,
  behind: 0,
  is_detached: false,
  conflict_count: 0,
  files: [
    change('lib/one.ts', 'modified', 'unmodified'),
    change('src/two.ts', 'unmodified', 'modified'),
    change('src/three.ts', 'unmodified', 'untracked'),
  ],
}

interface RenderOptions {
  status?: GitRepoStatus | null
  cwd?: string | null
  onCommit?: (message: string, amend: boolean) => Promise<void>
  onRevert?: (paths: string[]) => Promise<void>
}

function renderSection(options: RenderOptions = {}) {
  const props = {
    onRefresh: vi.fn(),
    onSelectFile: vi.fn(),
    onCommit: vi.fn(options.onCommit ?? (async () => undefined)),
    onRevert: vi.fn(options.onRevert ?? (async () => undefined)),
  }
  render(
    <GitCommitSection
      status={options.status === undefined ? STATUS : options.status}
      loading={false}
      selectedFile={null}
      cwd={options.cwd === null ? undefined : options.cwd ?? '/repo'}
      currentBranch="main"
      {...props}
    />,
  )
  return props
}

const button = (name: string) => screen.getByRole('button', { name })
const openMenu = (path: string, staged = false) => {
  fireEvent.contextMenu(button(`View ${staged ? 'staged' : 'working tree'} diff for ${path}`))
  return screen.getByRole('menu', { name: 'Git context menu' })
}
const clickMenuItem = async (menu: HTMLElement, name: string) => {
  await act(async () => {
    fireEvent.click(within(menu).getByRole('button', { name }))
  })
}

describe('GitCommitSection coverage', () => {
  beforeEach(() => {
    localStorage.clear()
    invoke.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('checks folders, shows mixed folder state, and collapses folders', () => {
    renderSection()
    fireEvent.click(button('Select folder src'))
    expect(button('Uncheck two.ts')).toHaveAttribute('aria-pressed', 'true')
    expect(button('Uncheck three.ts')).toBeInTheDocument()
    fireEvent.click(button('Deselect folder src'))
    expect(button('Check two.ts')).toBeInTheDocument()

    fireEvent.click(button('Check two.ts'))
    expect(button('Select folder src')).toHaveAttribute('aria-pressed', 'mixed')
    fireEvent.click(button('Uncheck two.ts'))
    expect(button('Select folder src')).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button('Collapse folder src'))
    expect(screen.queryByRole('button', { name: 'Check two.ts' })).not.toBeInTheDocument()
    expect(button('Expand folder src')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button('Expand folder src'))
    expect(button('Check two.ts')).toBeInTheDocument()

    fireEvent.click(button('Collapse all folders'))
    expect(button('Expand folder lib')).toBeInTheDocument()
    expect(button('Expand folder src')).toBeInTheDocument()
    fireEvent.click(button('Expand all folders'))
    expect(button('Collapse folder lib')).toBeInTheDocument()
    expect(button('Collapse folder src')).toBeInTheDocument()
  })

  it('toggles every visible file and filters the lists by search', () => {
    renderSection()
    fireEvent.click(button('Select all'))
    expect(button('Uncheck one.ts')).toBeInTheDocument()
    expect(button('Uncheck two.ts')).toBeInTheDocument()
    expect(button('Uncheck three.ts')).toBeInTheDocument()
    fireEvent.click(button('Deselect all'))
    expect(button('Check one.ts')).toBeInTheDocument()

    const search = screen.getByRole('searchbox', { name: 'Search changed files' })
    fireEvent.change(search, { target: { value: 'nothing-here' } })
    expect(screen.getByText('No matching staged files')).toBeInTheDocument()
    expect(screen.getByText('No matching unstaged files')).toBeInTheDocument()
    expect(button('Select all')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: ' TWO ' } })
    fireEvent.click(button('Select all'))
    expect(button('Uncheck two.ts')).toBeInTheDocument()
    fireEvent.click(button('Clear file search'))
    expect(button('Check three.ts')).toBeInTheDocument()
    expect(button('Select all')).toBeInTheDocument()
  })

  it('restores list view from storage and persists view mode changes', () => {
    localStorage.setItem('omniterm:git-view-mode', 'list')
    const props = renderSection()
    expect(button('Check src/two.ts')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse all folders' })).not.toBeInTheDocument()

    fireEvent.click(button('View staged diff for lib/one.ts'))
    expect(props.onSelectFile).toHaveBeenCalledWith('lib/one.ts', true)
    fireEvent.click(button('View working tree diff for src/two.ts'))
    expect(props.onSelectFile).toHaveBeenCalledWith('src/two.ts', false)
    fireEvent.click(button('Check src/two.ts'))
    expect(button('Uncheck src/two.ts')).toBeInTheDocument()

    fireEvent.click(button('Switch to Tree view'))
    expect(localStorage.getItem('omniterm:git-view-mode')).toBe('tree')
    expect(button('Collapse folder src')).toBeInTheDocument()
  })

  it('defaults to tree view and still toggles when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderSection()
    expect(button('Collapse folder src')).toBeInTheDocument()
    fireEvent.click(button('Switch to List view'))
    expect(button('Check src/two.ts')).toBeInTheDocument()
  })

  it('collapses groups and reports when only staged changes exist', () => {
    renderSection({ status: { ...STATUS, files: [change('lib/one.ts', 'added', 'unmodified')] } })
    expect(screen.getByText('No unstaged changes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stage all' })).not.toBeInTheDocument()

    const staged = screen.getByRole('button', { name: /Staged Changes/ })
    fireEvent.click(staged)
    expect(staged).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Check one.ts' })).not.toBeInTheDocument()
    const changes = screen.getByRole('button', { name: /^Changes/ })
    fireEvent.click(changes)
    expect(screen.queryByText('No unstaged changes')).not.toBeInTheDocument()
    fireEvent.click(changes)
    fireEvent.click(staged)
    expect(button('Check one.ts')).toBeInTheDocument()
  })

  it('stages and unstages single files and whole groups', async () => {
    const props = renderSection()
    await act(async () => {
      fireEvent.click(button('Stage src/two.ts'))
    })
    expect(invoke).toHaveBeenLastCalledWith('git_stage', { cwd: '/repo', paths: ['src/two.ts'] })
    await act(async () => {
      fireEvent.click(button('Unstage lib/one.ts'))
    })
    expect(invoke).toHaveBeenLastCalledWith('git_unstage', { cwd: '/repo', paths: ['lib/one.ts'] })
    await act(async () => {
      fireEvent.click(button('Stage all'))
    })
    expect(invoke).toHaveBeenLastCalledWith('git_stage', { cwd: '/repo', paths: ['src/two.ts', 'src/three.ts'] })
    await act(async () => {
      fireEvent.click(button('Unstage all'))
    })
    expect(invoke).toHaveBeenLastCalledWith('git_unstage', { cwd: '/repo', paths: ['lib/one.ts'] })
    expect(props.onRefresh).toHaveBeenCalledTimes(4)
  })

  it('shows staging errors and ignores stage requests while one is running', async () => {
    invoke.mockRejectedValueOnce(new Error('index.lock exists'))
    const props = renderSection()
    await act(async () => {
      fireEvent.click(button('Stage src/two.ts'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('index.lock exists')

    invoke.mockRejectedValueOnce('permission denied')
    await act(async () => {
      fireEvent.click(button('Unstage lib/one.ts'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('permission denied')
    expect(props.onRefresh).not.toHaveBeenCalled()

    let release: () => void = () => undefined
    invoke.mockReturnValueOnce(new Promise<void>((resolve) => {
      release = resolve
    }))
    fireEvent.click(button('Stage src/two.ts'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(button('Stage all')).toBeDisabled()
    const menu = openMenu('src/three.ts')
    fireEvent.click(within(menu).getByRole('button', { name: 'Stage' }))
    expect(invoke).toHaveBeenCalledTimes(3)
    await act(async () => {
      release()
    })
    expect(button('Stage all')).not.toBeDisabled()
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('runs stage, unstage, and discard from the context menu', async () => {
    const props = renderSection()
    await clickMenuItem(openMenu('src/two.ts'), 'Stage')
    expect(invoke).toHaveBeenLastCalledWith('git_stage', { cwd: '/repo', paths: ['src/two.ts'] })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await clickMenuItem(openMenu('lib/one.ts', true), 'Unstage')
    expect(invoke).toHaveBeenLastCalledWith('git_unstage', { cwd: '/repo', paths: ['lib/one.ts'] })

    await clickMenuItem(openMenu('src/three.ts'), 'Discard Changes')
    expect(props.onRevert).toHaveBeenCalledWith(['src/three.ts'])
    expect(props.onRefresh).toHaveBeenCalledTimes(3)
  })

  it('confirms file deletion from the context menu', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const props = renderSection()
    await clickMenuItem(openMenu('src/two.ts'), 'Delete File')
    expect(confirm).toHaveBeenCalledWith("Are you sure you want to permanently delete 'src/two.ts'?")
    expect(invoke).not.toHaveBeenCalled()

    await clickMenuItem(openMenu('src/two.ts'), 'Delete File')
    expect(invoke).toHaveBeenCalledWith('git_delete_file', { cwd: '/repo', filePath: 'src/two.ts' })
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('opens blame, branch compare, and stash dialogs for a repository', () => {
    const props = renderSection()
    fireEvent.click(within(openMenu('src/two.ts')).getByRole('button', { name: 'Annotate (Blame)' }))
    expect(screen.getByTestId('blame')).toHaveAttribute('data-path', 'src/two.ts')
    fireEvent.click(button('stub close blame'))
    expect(screen.queryByTestId('blame')).not.toBeInTheDocument()

    fireEvent.click(within(openMenu('src/two.ts')).getByRole('button', { name: 'Compare with Branch...' }))
    expect(screen.getByTestId('compare')).toHaveAttribute('data-branch', 'main')
    fireEvent.click(button('stub pick branch'))
    expect(props.onSelectFile).toHaveBeenCalledWith('src/two.ts', false, 'dev')
    expect(screen.queryByTestId('compare')).not.toBeInTheDocument()
    fireEvent.click(within(openMenu('src/two.ts')).getByRole('button', { name: 'Compare with Branch...' }))
    fireEvent.click(button('stub close compare'))
    expect(screen.queryByTestId('compare')).not.toBeInTheDocument()

    fireEvent.click(button('Git Stashes'))
    expect(screen.getByTestId('stash')).toHaveAttribute('data-cwd', '/repo')
    fireEvent.click(button('stub stash refresh'))
    expect(props.onRefresh).toHaveBeenCalled()
    fireEvent.click(button('stub close stash'))
    expect(screen.queryByTestId('stash')).not.toBeInTheDocument()
  })

  it('disables repository actions when no working directory is known', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    renderSection({ cwd: null })
    expect(button('Stage all')).toBeDisabled()
    expect(button('Unstage all')).toBeDisabled()
    expect(button('Stage src/two.ts')).toBeDisabled()

    fireEvent.click(within(openMenu('src/two.ts')).getByRole('button', { name: 'Stage' }))
    await clickMenuItem(openMenu('src/two.ts'), 'Delete File')
    fireEvent.click(within(openMenu('src/two.ts')).getByRole('button', { name: 'Annotate (Blame)' }))
    fireEvent.click(within(openMenu('src/two.ts')).getByRole('button', { name: 'Compare with Branch...' }))
    fireEvent.click(button('Git Stashes'))
    expect(invoke).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.queryByTestId('blame')).not.toBeInTheDocument()
    expect(screen.queryByTestId('compare')).not.toBeInTheDocument()
    expect(screen.queryByTestId('stash')).not.toBeInTheDocument()
  })

  it('commits staged files directly and supports amending without a selection', async () => {
    const props = renderSection()
    const message = screen.getByLabelText('Commit message')
    expect(button('Commit')).toBeDisabled()

    fireEvent.click(button('Check one.ts'))
    fireEvent.change(message, { target: { value: 'fix: staged only' } })
    await act(async () => {
      fireEvent.click(button('Commit'))
    })
    expect(invoke).not.toHaveBeenCalled()
    expect(props.onCommit).toHaveBeenCalledWith('fix: staged only', false)
    expect(message).toHaveValue('')
    expect(button('Check one.ts')).toBeInTheDocument()

    fireEvent.change(message, { target: { value: 'fix: amend' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Amend last commit' }))
    await act(async () => {
      fireEvent.keyDown(message, { key: 'Enter', ctrlKey: true })
    })
    expect(props.onCommit).toHaveBeenLastCalledWith('fix: amend', true)
    expect(screen.getByRole('checkbox', { name: 'Amend last commit' })).not.toBeChecked()
  })

  it('shows the committing state until the commit finishes', async () => {
    let finish: () => void = () => undefined
    const props = renderSection({
      onCommit: () => new Promise<void>((resolve) => {
        finish = resolve
      }),
    })
    fireEvent.click(button('Check two.ts'))
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'wip' } })
    await act(async () => {
      fireEvent.click(button('Commit'))
    })
    expect(button('Committing...')).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('Commit message'), { key: 'Enter', metaKey: true })
    expect(props.onCommit).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish()
    })
    expect(button('Commit')).toBeDisabled()
  })

  it('asks before discarding selected files and blocks repeats while reverting', async () => {
    let finish: () => void = () => undefined
    const props = renderSection({
      onRevert: () => new Promise<void>((resolve) => {
        finish = resolve
      }),
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    fireEvent.click(button('Check two.ts'))
    fireEvent.click(button('Check three.ts'))
    fireEvent.click(button('Discard selected changes'))
    expect(confirm).toHaveBeenCalledWith('Discard changes to 2 file(s)?')
    expect(props.onRevert).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(button('Discard selected changes'))
    })
    expect(props.onRevert).toHaveBeenCalledWith(['src/two.ts', 'src/three.ts'])
    expect(button('Discard selected changes')).toBeDisabled()
    await act(async () => {
      finish()
    })
    expect(screen.queryByRole('button', { name: 'Discard selected changes' })).not.toBeInTheDocument()
  })

  it('shows an empty state when there is no status', () => {
    renderSection({ status: null })
    expect(screen.getByText('No local changes')).toBeInTheDocument()
    expect(button('Select all')).toBeDisabled()
  })
})
