/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { QuotaProfilesDashboard } from '../QuotaProfilesDashboard'
import { getProfileDashboard, resetProfileDashboard, setDashboardOpen } from '../profileDashboard'
import { getQuotaState, resetQuotaStore } from '../quotaStore'

import { NOW, profile, reading, seed, terminal } from './quotaFixtures'

beforeEach(() => {
  resetQuotaStore()
  resetProfileDashboard()
})
afterEach(() => {
  resetQuotaStore()
  resetProfileDashboard()
})

describe('QuotaProfilesDashboard', () => {
  it('renders the active engine profiles without discovery or recommendation controls', () => {
    const active = terminal({
      profileKey: 'claude:launcher:claude-work',
      profileName: 'claude-work',
      profileDir: null,
      launcher: 'claude-work',
    })
    seed({
      terminals: [active],
      profiles: [profile(reading(20, 30), { key: active.profileKey, profileName: active.profileName, profileDir: null, launcher: active.launcher })],
    })

    render(<QuotaProfilesDashboard />)

    expect(screen.getByRole('listitem', { name: 'claude-work profile' })).toBeInTheDocument()
    expect(screen.getByText('1 active profile · live engine status')).toBeInTheDocument()
    expect(screen.queryByText(/Use now/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Fetch/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fetch all' })).not.toBeInTheDocument()
  })

  it('collapses multiple active terminals for the same profile into one row', () => {
    const active = terminal({ profileKey: 'claude:launcher:claude-work', profileName: 'claude-work', profileDir: null, launcher: 'claude-work' })
    const second = { ...active, sessionId: 's2', instanceKey: 's2:10:100' }
    seed({
      terminals: [active, second],
      profiles: [profile(reading(20), { key: active.profileKey, profileName: active.profileName, profileDir: null, launcher: active.launcher })],
    })

    render(<QuotaProfilesDashboard />)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('listitem', { name: 'claude-work profile' })).toHaveTextContent('2 active terminals')
  })

  it('shows a stale reading with the current engine error', () => {
    const current = profile(reading(40), {
      snapshot: { windows: [], fetchedAt: 2, error: 'timeout', message: 'Quota service timed out.' },
    })
    seed({ profiles: [current] })

    render(<QuotaProfilesDashboard />)

    const row = screen.getByRole('listitem', { name: 'work profile' })
    expect(row).toHaveTextContent('Quota service timed out. · showing last good reading')
    expect(within(row).getByLabelText('5h 40% used')).toBeInTheDocument()
  })

  it('explains an empty active state and closes on Escape, the close button or the backdrop', () => {
    seed({ terminals: [], profiles: [] })
    render(<QuotaProfilesDashboard />)
    expect(screen.getByText('No Claude Code profile is active in an open terminal.')).toBeInTheDocument()
    for (const close of [
      () => fireEvent.keyDown(window, { key: 'Escape' }),
      () => fireEvent.click(screen.getByRole('button', { name: 'Close profiles' })),
      () => fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement),
    ]) {
      act(() => setDashboardOpen(true))
      close()
      expect(getProfileDashboard().open).toBe(false)
    }
    act(() => setDashboardOpen(true))
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(getProfileDashboard().open).toBe(true)
  })

  it('moves by its header', () => {
    seed()
    render(<QuotaProfilesDashboard />)
    const dialog = screen.getByRole('dialog')
    const handle = screen.getByTestId('aq-pd-handle')

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 160, clientY: 140 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(dialog.style.transform).toBe('translate(60px, 40px)')
  })

  it('reflects store changes while open', () => {
    seed()
    render(<QuotaProfilesDashboard />)
    expect(screen.getByRole('listitem', { name: 'work profile' })).toBeInTheDocument()

    act(() => seed({ terminals: [], profiles: [] }))
    expect(screen.getByText('No Claude Code profile is active in an open terminal.')).toBeInTheDocument()
    expect(getQuotaState().profiles).toEqual({})
  })

  it('covers window edge cases and formatAgo variants', () => {
    const active = terminal({
      profileKey: 'claude:launcher:claude-work',
      profileName: 'claude-work',
      profileDir: null,
      launcher: 'claude-work',
    })
    const snap1 = {
      windows: [
        { kind: 'session' as const, label: 'Session', usedPct: 80, resetsAt: NOW - 1000 },
      ],
      fetchedAt: NOW - 30_000,
    }
    seed({
      terminals: [active],
      profiles: [profile(snap1, { key: active.profileKey, profileName: active.profileName, profileDir: null, launcher: active.launcher })],
    })

    const { rerender } = render(<QuotaProfilesDashboard />)
    expect(screen.getByText('5h')).toBeInTheDocument()
    expect(screen.getByText('Week —')).toBeInTheDocument()
    expect(screen.getByText(/just now/)).toBeInTheDocument()

    seed({
      terminals: [active],
      profiles: [profile({ ...snap1, fetchedAt: NOW - 12 * 60_000 }, { key: active.profileKey, profileName: active.profileName, profileDir: null, launcher: active.launcher })],
    })
    rerender(<QuotaProfilesDashboard />)
    expect(screen.getByText(/12m ago/)).toBeInTheDocument()

    seed({
      terminals: [active],
      profiles: [profile({ ...snap1, fetchedAt: NOW - 3 * 3600_000 }, { key: active.profileKey, profileName: active.profileName, profileDir: null, launcher: active.launcher })],
    })
    rerender(<QuotaProfilesDashboard />)
    expect(screen.getByText(/3h ago/)).toBeInTheDocument()

    seed({
      terminals: [active],
      profiles: [profile({ ...snap1, fetchedAt: NOW - 50 * 3600_000 }, { key: active.profileKey, profileName: active.profileName, profileDir: null, launcher: active.launcher })],
    })
    rerender(<QuotaProfilesDashboard />)
    expect(screen.getByText(/2d ago/)).toBeInTheDocument()
  })

  it('renders limited status, error without reading, fetching status, and waiting for first reading', () => {
    const limitedProfile = profile(
      {
        windows: [{ kind: 'session' as const, label: 'Session', usedPct: 95, resetsAt: NOW + 3600_000 }],
        fetchedAt: NOW - 10_000,
      },
      { key: 'claude:p1', profileName: 'limited-prof', profileDir: 'p1', launcher: null },
    )
    const errorProfile = profile(undefined, {
      key: 'claude:p2',
      profileName: 'error-prof',
      profileDir: 'p2',
      launcher: null,
      snapshot: { windows: [], fetchedAt: NOW, error: 'failed', message: 'Failed to probe' },
    })
    const fetchingProfile = profile(undefined, {
      key: 'claude:p3',
      profileName: 'fetching-prof',
      profileDir: 'p3',
      launcher: null,
      fetching: true,
    })
    const freshProfile = profile(undefined, {
      key: 'claude:p4',
      profileName: 'fresh-prof',
      profileDir: 'p4',
      launcher: null,
    })

    seed({
      terminals: [
        terminal({ sessionId: 's1', profileKey: 'claude:p1', profileName: 'limited-prof', profileDir: 'p1', launcher: null }),
        terminal({ sessionId: 's2', profileKey: 'claude:p2', profileName: 'error-prof', profileDir: 'p2', launcher: null }),
        terminal({ sessionId: 's3', profileKey: 'claude:p3', profileName: 'fetching-prof', profileDir: 'p3', launcher: null }),
        terminal({ sessionId: 's4', profileKey: 'claude:p4', profileName: 'fresh-prof', profileDir: 'p4', launcher: null }),
      ],
      profiles: [limitedProfile, errorProfile, fetchingProfile, freshProfile],
    })

    render(<QuotaProfilesDashboard />)
    expect(screen.getByText(/Limited ·/)).toBeInTheDocument()
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByText(/Failed to probe/)).toBeInTheDocument()
    expect(screen.getByText(/Updating quota…/)).toBeInTheDocument()
    expect(screen.getByText(/waiting for first quota reading/)).toBeInTheDocument()
  })

  it('ignores non-Escape keys when open', () => {
    seed()
    render(<QuotaProfilesDashboard />)
    act(() => setDashboardOpen(true))
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(getProfileDashboard().open).toBe(true)
  })
})
