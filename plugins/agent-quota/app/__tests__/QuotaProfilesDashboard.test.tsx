/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DiscoveredProfile, QuotaSnapshot } from '../../src/types'
import type { DashboardDeps } from '../profileDashboard'

import { QuotaProfilesDashboard } from '../QuotaProfilesDashboard'
import { QuotaQuickPopover } from '../QuotaQuickPopover'
import { getProfileDashboard, resetProfileDashboard, setDashboardOpen } from '../profileDashboard'
import { getQuotaState, resetQuotaStore } from '../quotaStore'

import { NOW, profile, reading, seed } from './quotaFixtures'

const HOUR = 3_600_000
const WORK: DiscoveredProfile = { agent: 'claude', profileName: 'claude-work', profileDir: null, launcher: 'claude-work' }
const HOME: DiscoveredProfile = { agent: 'claude', profileName: 'claude-home', profileDir: null, launcher: 'claude-home' }
const SIDE: DiscoveredProfile = { agent: 'claude', profileName: 'claude-side', profileDir: null, launcher: 'claude-side' }

const usage = (session: number, weekly: number, sessionResetIn = 2 * HOUR): QuotaSnapshot => ({
  windows: [
    { kind: 'session', label: 'Current session', usedPct: session, resetsAt: NOW + sessionResetIn },
    { kind: 'weekly', label: 'Current week', usedPct: weekly, resetsAt: NOW + 4 * 24 * HOUR },
  ],
  fetchedAt: NOW,
})

function deps(readings: Record<string, QuotaSnapshot>, listed: DiscoveredProfile[] = [WORK, HOME, SIDE]): DashboardDeps {
  return {
    listProfiles: vi.fn(async () => listed),
    fetchUsage: vi.fn(async (request) => readings[request.launcher ?? ''] ?? { windows: [], fetchedAt: NOW, error: 'timeout' as const, message: 'claude /usage timed out.' }),
  }
}

beforeEach(() => {
  resetQuotaStore()
  resetProfileDashboard()
  seed({ terminals: [], profiles: [] })
})
afterEach(() => {
  resetQuotaStore()
  resetProfileDashboard()
})

describe('QuotaProfilesDashboard', () => {
  it('lists profiles on open but reads quota only when asked', async () => {
    const live = deps({})
    render(<QuotaProfilesDashboard deps={live} />)
    await screen.findByRole('listitem', { name: 'claude-work profile' })
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(live.fetchUsage).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Press Fetch all')
  })

  it('fetches all, recommends a profile with its command, and marks limited and failed rows', async () => {
    const writeText = vi.fn(async () => {})
    window.omnitermAPI = { ...(window.omnitermAPI ?? {}), clipboard: { writeText } } as unknown as typeof window.omnitermAPI
    const live = deps({ 'claude-work': usage(20, 30), 'claude-home': usage(92, 40, 90 * 60_000) })
    render(<QuotaProfilesDashboard deps={live} />)
    await screen.findByRole('listitem', { name: 'claude-work profile' })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch all' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Use now: claude-work'))

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('70% of 5h left · 65% of weekly left')
    fireEvent.click(within(banner).getByRole('button', { name: 'Copy claude-work' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('claude-work'))

    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual(['best', 'limited', 'error'])
    expect(within(rows[1]).getByText('Limited · 1h 30m')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Failed: claude /usage timed out.')).toBeInTheDocument()
    expect(within(rows[0]).getByText('fetched just now')).toBeInTheDocument()
    expect(within(rows[0]).getByLabelText('5h 20% used')).toBeInTheDocument()
  })

  it('names the profile that frees up first when none has room', async () => {
    const live = deps({ 'claude-work': usage(95, 30, 3 * HOUR), 'claude-home': usage(91, 30, HOUR) }, [WORK, HOME])
    render(<QuotaProfilesDashboard deps={live} />)
    await screen.findByRole('listitem', { name: 'claude-work profile' })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch all' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No profile has room right now.'))
    expect(screen.getByRole('status')).toHaveTextContent('claude-home frees up first: 5h limit reached — available in 1h 00m')
  })

  it('re-reads one profile and reuses the engine reading of a monitored profile', async () => {
    seed({ terminals: [], profiles: [profile(reading(50, 20), { key: 'claude:launcher:claude-side', profileName: 'claude-side', launcher: 'claude-side', profileDir: null })] })
    const live = deps({ 'claude-home': usage(10, 10) })
    render(<QuotaProfilesDashboard deps={live} />)
    const side = await screen.findByRole('listitem', { name: 'claude-side profile' })
    expect(within(side).getByLabelText('5h 50% used')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch claude-home' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Use now: claude-home'))
    expect(live.fetchUsage).toHaveBeenCalledTimes(1)
  })

  it('explains an empty list and closes on Escape, the close button or the backdrop', async () => {
    render(<QuotaProfilesDashboard deps={deps({}, [])} />)
    await screen.findByText(/No profiles found/)
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

  it('opens from the quick settings, which close behind it', () => {
    render(<QuotaQuickPopover />)
    fireEvent.click(screen.getByRole('button', { name: 'Profiles' }))
    expect(getProfileDashboard().open).toBe(true)
    expect(getQuotaState().quickOpen).toBe(false)
  })
})
