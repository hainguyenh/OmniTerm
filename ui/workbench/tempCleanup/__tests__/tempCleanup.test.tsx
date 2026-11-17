/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

import { TempCleanupOverlay } from '../TempCleanupDialog'
import { daysSince, parseCleanReport, parseTempGroup, selectedBytes } from '../tempCleanupModel'
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
    expect(parseCleanReport('nope')).toEqual({ removed: 0, freedBytes: 0, kept: 0, skipped: [] })
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
})

describe('TempCleanupDialog', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    act(() => useTempCleanup.getState().setOpen(true))
  })

  it('lists the groups, then deletes the ticked ones idle for the chosen days and rescans', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'temp_cleanup_scan') return Promise.resolve(groups)
      return Promise.resolve({ removed: 3, freedBytes: 5_000_000, kept: 0, skipped: [{ name: 'locked.tmp', reason: 'in use' }] })
    })
    render(<TempCleanupOverlay />)
    expect(await screen.findAllByTestId('temp-cleanup-row')).toHaveLength(2)
    const del = screen.getByTestId('temp-cleanup-delete') as HTMLButtonElement
    expect(del.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Select claude-*'))
    await waitFor(() => expect(del.disabled).toBe(false))
    fireEvent.click(del)
    expect(screen.getByTestId('temp-cleanup-status').textContent).toMatch(/cannot be undone/)
    fireEvent.click(screen.getByText('Delete Permanently'))
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('temp_cleanup_run', { keys: ['claude-*'], olderThanHours: 24 }),
    )
    await waitFor(() => expect(screen.getByTestId('temp-cleanup-status').textContent).toMatch(/1 entry skipped.*locked\.tmp/))
    expect(invokeMock.mock.calls.filter(([c]) => c === 'temp_cleanup_scan')).toHaveLength(2)
  })

  it('shows a scan failure instead of an empty list', async () => {
    invokeMock.mockRejectedValue('Cannot read the temp folder')
    render(<TempCleanupOverlay />)
    expect(await screen.findByText(/Cannot read the temp folder/)).toBeTruthy()
  })
})
