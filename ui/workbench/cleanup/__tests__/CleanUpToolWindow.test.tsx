/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
const openMock = vi.fn()
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => openMock(...args) }))

import { provideNotificationService } from '../../../ide/workbench/contributions'
import { useSessionCleanup } from '../../sessions/sessionCleanupStore'
import { useTempCleanup } from '../../tempCleanup/tempCleanupStore'
import { useCleanupRoots } from '../cleanupRootsStore'
import { CleanUpToolWindow } from '../CleanUpToolWindow'
import { useCleanUpView } from '../cleanUpViewStore'
import { useRustCleanup } from '../rustCleanupStore'
import { useWorktreeCleanup } from '../worktreeCleanupStore'

const notify = vi.fn()
const NOW_SECS = Math.floor(Date.now() / 1000)

const rustTargets = [
  { project: 'D:/code/app', name: 'app', target: 'D:/code/app/target', files: 9, bytes: 3_000_000, incrementalBytes: 1_000_000, lastBuild: NOW_SECS - 86_400 },
  { project: 'D:/code/lib', name: 'lib', target: 'D:/code/lib/target', files: 3, bytes: 2_000_000, incrementalBytes: 0, lastBuild: NOW_SECS },
]

const worktree = (path: string, patch: Record<string, unknown>) => ({
  path,
  repo: 'D:/code/app',
  repoName: 'app',
  branch: path.split('/').pop(),
  head: 'abc',
  locked: false,
  missing: false,
  changes: 0,
  lastActiveMs: Date.now(),
  upstream: 'origin/x',
  upstreamGone: false,
  ahead: 0,
  behind: 0,
  base: 'master',
  merged: false,
  bytes: 1000,
  ...patch,
})

beforeEach(() => {
  invokeMock.mockReset()
  openMock.mockReset()
  notify.mockReset()
  provideNotificationService({ notify } as never)
  localStorage.clear()
  useCleanupRoots.setState({ roots: [] })
  useCleanUpView.setState({ tab: 'rust' })
  useRustCleanup.setState({ targets: null, scannedAt: 0, job: null, status: null, error: null })
  useWorktreeCleanup.setState({ entries: null, scannedAt: 0, job: null, status: null, error: null })
  useSessionCleanup.setState({ open: false })
  useTempCleanup.setState({ open: false })
})

describe('the Clean Up tool window', () => {
  it('opens the existing Sessions and Temp dialogs from their tabs', () => {
    render(<CleanUpToolWindow />)
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }))
    fireEvent.click(screen.getByRole('button', { name: /Clean Up Old Sessions/ }))
    expect(useSessionCleanup.getState().open).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Temp' }))
    fireEvent.click(screen.getByRole('button', { name: /Clean Temp Files/ }))
    expect(useTempCleanup.getState().open).toBe(true)
  })

  it('scans for Rust build folders, including added folders, and deletes only the caches when asked', async () => {
    openMock.mockResolvedValue('D:/extra')
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'rust_cleanup_scan') return rustTargets
      if (command === 'rust_cleanup_run') return [{ target: 'D:/code/app/target', freedBytes: 1_000_000, error: null }]
      return undefined
    })
    render(<CleanUpToolWindow />)
    fireEvent.click(screen.getByTestId('cleanup-roots-add'))
    await waitFor(() => expect(useCleanupRoots.getState().roots).toEqual(['D:/extra']))

    fireEvent.click(screen.getByTestId('rust-cleanup-scan'))
    await waitFor(() => expect(screen.getAllByTestId('rust-cleanup-row')).toHaveLength(2))
    expect(invokeMock).toHaveBeenCalledWith('rust_cleanup_scan', { extraRoots: ['D:/extra'] })

    // `lib` has no cache: selected alone, Delete Cache has nothing to free.
    fireEvent.click(screen.getByLabelText('Select lib'))
    expect(screen.getByTestId('rust-cleanup-incremental')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Select app'))
    fireEvent.click(screen.getByTestId('rust-cleanup-incremental'))
    expect(screen.getByTestId('cleanup-confirm').textContent).toContain('incremental caches of 2 projects')
    await act(async () => fireEvent.click(screen.getByTestId('cleanup-confirm-ok')))

    expect(invokeMock).toHaveBeenCalledWith('rust_cleanup_run', {
      targets: ['D:/code/app/target', 'D:/code/lib/target'],
      mode: 'incremental',
    })
    await waitFor(() => expect(screen.getByTestId('rust-cleanup-status').textContent).toContain('freed'))
  })

  it('suggests which worktrees to remove and asks again before discarding uncommitted changes', async () => {
    useCleanUpView.setState({ tab: 'worktrees' })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'worktree_cleanup_scan') {
        return [
          worktree('D:/wt/merged', { merged: true }),
          worktree('D:/wt/dirty', { changes: 2 }),
          worktree('D:/wt/busy', {}),
        ]
      }
      if (command === 'worktree_cleanup_remove') {
        return { removed: ['D:/wt/merged', 'D:/wt/dirty'], deletedBranches: ['merged'], keptBranches: [], failed: [] }
      }
      return undefined
    })
    render(<CleanUpToolWindow />)
    fireEvent.click(screen.getByTestId('worktree-cleanup-scan'))
    await waitFor(() => expect(screen.getAllByTestId('worktree-cleanup-row')).toHaveLength(3))
    const verdicts = screen.getAllByTestId('worktree-cleanup-verdict').map((node) => node.textContent)
    expect(verdicts).toEqual(['Safe to remove', 'Keep', 'Keep'])

    fireEvent.click(screen.getByTestId('worktree-cleanup-select-safe'))
    fireEvent.click(screen.getByLabelText('Select D:/wt/dirty'))
    fireEvent.click(screen.getByTestId('worktree-cleanup-remove'))
    const confirm = screen.getByTestId('cleanup-confirm')
    expect(screen.getByTestId('cleanup-confirm-ok')).toBeDisabled()
    fireEvent.click(within(confirm).getByRole('checkbox'))
    await act(async () => fireEvent.click(screen.getByTestId('cleanup-confirm-ok')))

    expect(invokeMock).toHaveBeenCalledWith('worktree_cleanup_remove', {
      paths: ['D:/wt/merged', 'D:/wt/dirty'],
      force: true,
      deleteMergedBranches: true,
    })
    await waitFor(() => expect(screen.getAllByTestId('worktree-cleanup-row')).toHaveLength(1))
    expect(screen.getByTestId('worktree-cleanup-status').textContent).toBe('Removed 2 worktrees, deleted 1 branch.')
    // The tool window is not on screen in this test: the result is also a notification.
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Worktrees removed' }))
  })

  it('lists the folders ended test runs left and deletes them after confirmation', async () => {
    const roaming = 'C:/Users/u/AppData/Roaming/com.omniterm.tests.11'
    const local = 'C:/Users/u/AppData/Local/com.omniterm.tests.11'
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'test_data_cleanup_scan') {
        return [
          { path: roaming, pid: 11, files: 1, bytes: 2048 },
          { path: local, pid: 11, files: 0, bytes: 0 },
        ]
      }
      if (command === 'test_data_cleanup_run') {
        return [
          { path: roaming, freedBytes: 2048, error: null },
          { path: local, freedBytes: 0, error: 'Access is denied.' },
        ]
      }
      return undefined
    })
    render(<CleanUpToolWindow />)
    fireEvent.click(screen.getByRole('tab', { name: 'Test Data' }))
    expect(screen.getByTestId('test-data-cleanup-remove')).toBeDisabled()
    fireEvent.click(screen.getByTestId('test-data-cleanup-scan'))
    await waitFor(() => expect(screen.getAllByTestId('test-data-cleanup-row')).toHaveLength(2))

    fireEvent.click(screen.getByTestId('test-data-cleanup-remove'))
    expect(screen.getByTestId('cleanup-confirm').textContent).toContain('Delete 2 folders (2.0 KB)')
    await act(async () => fireEvent.click(screen.getByTestId('cleanup-confirm-ok')))

    expect(invokeMock).toHaveBeenCalledWith('test_data_cleanup_run', { paths: [roaming, local] })
    await waitFor(() => expect(screen.getAllByTestId('test-data-cleanup-row')).toHaveLength(1))
    expect(screen.getByTestId('test-data-cleanup-status').textContent).toBe(
      'Removed 1 folder, freed 2.0 KB; 1 folder could not be removed.',
    )
  })

  it('removes a clean worktree without forcing', async () => {
    useCleanUpView.setState({ tab: 'worktrees' })
    invokeMock.mockImplementation(async (command: string) =>
      command === 'worktree_cleanup_scan'
        ? [worktree('D:/wt/merged', { merged: true })]
        : { removed: ['D:/wt/merged'], deletedBranches: [], keptBranches: [], failed: [] },
    )
    render(<CleanUpToolWindow />)
    fireEvent.click(screen.getByTestId('worktree-cleanup-scan'))
    await waitFor(() => expect(screen.getAllByTestId('worktree-cleanup-row')).toHaveLength(1))
    fireEvent.click(screen.getByLabelText('Delete merged branches'))
    fireEvent.click(screen.getByTestId('worktree-cleanup-select-safe'))
    fireEvent.click(screen.getByTestId('worktree-cleanup-remove'))
    await act(async () => fireEvent.click(screen.getByTestId('cleanup-confirm-ok')))
    expect(invokeMock).toHaveBeenCalledWith('worktree_cleanup_remove', {
      paths: ['D:/wt/merged'],
      force: false,
      deleteMergedBranches: false,
    })
  })
})
