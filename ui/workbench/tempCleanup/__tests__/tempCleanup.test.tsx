/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
const listeners = new Map<string, (event: { payload: unknown }) => void>()
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler)
    return () => listeners.delete(event)
  },
}))

import { useTasks } from '../../../ide/workbench/tasks'
import { parseProgress, progressText } from '../../cleanupJob'
import { TempCleanupOverlay } from '../TempCleanupDialog'
import { applyCleanReport, daysSince, parseCleanReport, parseTempGroup, selectedBytes } from '../tempCleanupModel'
import { useTempCleanup } from '../tempCleanupStore'

const NOW = Math.floor(Date.now() / 1000)
const groups = [
  { key: 'claude-*', entries: 3, files: 40, bytes: 5_000_000, oldest: NOW - 9 * 86_400, newest: NOW - 2 * 86_400 },
  { key: 'tmp*.tmp', entries: 10, files: 10, bytes: 2048, oldest: NOW, newest: NOW },
]

describe('the temp clean-up model', () => {
  it('rejects malformed groups and reports', () => {
    expect(parseTempGroup(null)).toBeNull()
    expect(parseTempGroup({ ...groups[0], bytes: -1 })).toBeNull()
    expect(parseTempGroup({ ...groups[0], key: '' })).toBeNull()
    expect(parseTempGroup(groups[0])).toEqual(groups[0])
    expect(parseCleanReport('nope')).toEqual({ removed: 0, freedBytes: 0, kept: 0, skipped: [], groups: [] })
    expect(parseCleanReport({ groups: [{ key: 'a', removed: 1, freedBytes: 2 }, { key: 'b', removed: -1 }] }).groups).toEqual([
      { key: 'a', removed: 1, freedBytes: 2 },
    ])
    expect(parseCleanReport({ removed: 2, freedBytes: 9, kept: 1, skipped: [{ name: 'a', reason: 'busy' }, 7] }).skipped).toEqual([
      { name: 'a', reason: 'busy' },
    ])
  })

  it('sums the selected groups and ages in whole days', () => {
    const parsed = groups.map((g) => parseTempGroup(g)!)
    expect(selectedBytes(parsed, new Set(['claude-*']))).toBe(5_000_000)
    expect(selectedBytes(parsed, new Set())).toBe(0)
    expect(daysSince(NOW - 3 * 86_400, Date.now())).toBe(3)
    expect(daysSince(NOW + 1000, Date.now())).toBe(0)
  })

  it('updates the groups from a clean-up report instead of scanning again', () => {
    const report = parseCleanReport({
      removed: 12,
      freedBytes: 4_000_000,
      kept: 1,
      skipped: [],
      groups: [{ key: 'claude-*', removed: 2, freedBytes: 4_000_000 }, { key: 'tmp*.tmp', removed: 10, freedBytes: 2048 }],
    })
    expect(applyCleanReport(groups, report)).toEqual([{ ...groups[0], entries: 1, bytes: 1_000_000 }])
  })

  it('reads progress events and says how far a job has got', () => {
    expect(parseProgress({ done: 1, total: 4, bytes: 2048 })).toEqual({ done: 1, total: 4, bytes: 2048 })
    expect(parseProgress({ done: -1, total: 4, bytes: 0 })).toBeNull()
    expect(parseProgress('x')).toBeNull()
    expect(progressText(null, 'entries', 'freed')).toBe('Starting…')
    expect(progressText({ done: 1200, total: 5000, bytes: 1024 }, 'entries', 'freed')).toBe(
      `${(1200).toLocaleString()} of ${(5000).toLocaleString()} entries · 1.0 KB freed`,
    )
  })
})

describe('TempCleanupDialog', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    listeners.clear()
    useTasks.setState({ tasks: [] })
    useTempCleanup.setState({ groups: null, scannedAt: 0, job: null, status: null, error: null })
    act(() => useTempCleanup.getState().setOpen(true))
  })

  it('lists the groups, then deletes the ticked ones idle for the chosen days without scanning again', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'temp_cleanup_scan') return Promise.resolve(groups)
      return Promise.resolve({
        removed: 3,
        freedBytes: 5_000_000,
        kept: 0,
        skipped: [{ name: 'locked.tmp', reason: 'in use' }],
        groups: [{ key: 'claude-*', removed: 3, freedBytes: 5_000_000 }],
      })
    })
    render(<TempCleanupOverlay />)
    expect(invokeMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('temp-cleanup-status').textContent).toMatch(/Press Scan/)
    fireEvent.click(screen.getByTestId('temp-cleanup-rescan'))
    expect(await screen.findAllByTestId('temp-cleanup-row')).toHaveLength(2)
    const del = screen.getByTestId('temp-cleanup-delete') as HTMLButtonElement
    expect(del.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Select claude-*'))
    await waitFor(() => expect(del.disabled).toBe(false))
    fireEvent.click(del)
    expect(screen.getByTestId('temp-cleanup-status').textContent).toMatch(/cannot be undone/)
    fireEvent.click(screen.getByText('Delete Permanently'))
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('temp_cleanup_run', { keys: ['claude-*'], olderThanHours: 7 * 24 }),
    )
    await waitFor(() => expect(screen.getByTestId('temp-cleanup-status').textContent).toMatch(/1 entry skipped.*locked\.tmp/))
    expect(invokeMock.mock.calls.filter(([c]) => c === 'temp_cleanup_scan')).toHaveLength(1)
    expect(screen.getAllByTestId('temp-cleanup-row')).toHaveLength(1)
  })

  it('keeps a delete running in the status bar when the dialog is hidden, with Cancel', async () => {
    let finish: (report: unknown) => void = () => undefined
    invokeMock.mockImplementation((command: string) => {
      if (command === 'temp_cleanup_scan') return Promise.resolve(groups)
      if (command === 'temp_cleanup_run') return new Promise((resolve) => (finish = resolve))
      return Promise.resolve(undefined)
    })
    render(<TempCleanupOverlay />)
    fireEvent.click(screen.getByTestId('temp-cleanup-rescan'))
    await screen.findAllByTestId('temp-cleanup-row')
    fireEvent.click(screen.getByLabelText('Select claude-*'))
    fireEvent.click(screen.getByTestId('temp-cleanup-delete'))
    fireEvent.click(screen.getByText('Delete Permanently'))
    await waitFor(() => expect(listeners.has('temp-cleanup:progress')).toBe(true))
    act(() => listeners.get('temp-cleanup:progress')?.({ payload: { phase: 'clean', done: 1, total: 3, bytes: 1024 } }))
    expect(screen.getByTestId('temp-cleanup-status').textContent).toBe('Deleting: 1 of 3 entries · 1.0 KB freed')

    fireEvent.click(screen.getByRole('button', { name: 'Run in Background' }))
    expect(screen.queryByTestId('temp-cleanup-dialog')).toBeNull()
    const task = useTasks.getState().tasks.find((t) => t.id === 'omniterm.tempCleanup')
    expect(task).toMatchObject({ title: 'Deleting temp files', fraction: 1 / 3 })
    act(() => task?.cancel?.())
    expect(invokeMock).toHaveBeenCalledWith('temp_cleanup_cancel')
    await act(async () => finish({ removed: 1, freedBytes: 1024, kept: 2, skipped: [], groups: [{ key: 'claude-*', removed: 1, freedBytes: 1024 }] }))
    await waitFor(() => expect(useTempCleanup.getState().job).toBeNull())
    expect(useTempCleanup.getState().status).toMatch(/^Cancelled after removing 1 entry/)
    expect(useTempCleanup.getState().groups?.[0]).toMatchObject({ key: 'claude-*', entries: 2 })
  })

  it('shows a scan failure instead of an empty list', async () => {
    invokeMock.mockRejectedValue('Cannot read the temp folder')
    render(<TempCleanupOverlay />)
    fireEvent.click(screen.getByTestId('temp-cleanup-rescan'))
    expect(await screen.findByText(/Cannot read the temp folder/)).toBeTruthy()
  })
})
