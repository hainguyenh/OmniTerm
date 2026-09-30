/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QuotaLine } from '../QuotaLine'
import { formatResetAbsolute, lineTooltip } from '../quotaPolicy'
import { QuotaPaneLines, SuspendedOverlay } from '../paneHosts'
import { DEFAULT_QUOTA_CONFIG } from '../quotaConfig'
import { getQuotaState, resetQuotaStore, setOverride } from '../quotaStore'

import { NOW, profile, reading, seed, terminal } from './quotaFixtures'

beforeEach(() => resetQuotaStore())
afterEach(() => resetQuotaStore())

describe('QuotaLine', () => {
  const window = { kind: 'session' as const, label: 'Current session', usedPct: 72, resetsAt: NOW + 65 * 60_000, breakdown: [{ label: 'Opus', usedPct: 72 }] }

  it('colours by zone relative to the limit, animates, and marks the limit', () => {
    render(<QuotaLine window={window} limit={80} animations showReset now={NOW} />)
    const line = screen.getByTestId('aq-line-session')
    expect(line).toHaveAttribute('data-zone', 'critical')
    expect(line).toHaveAttribute('data-animation', 'burning')
    // Used % centred in the fill; the danger zone (limit→100%) labelled with its size.
    expect(line.querySelector('.aq-used-value')).toHaveTextContent('72%')
    expect(line.querySelector('.aq-used-value')).toHaveStyle({ left: '36%' })
    expect(line.querySelector('.aq-danger-value')).toHaveTextContent('20%')
    // The danger zone has no fill of its own: it shares the track background past the marker.
    expect(line.querySelector('.aq-danger-zone')).toBeNull()
    expect(line).toHaveTextContent('1h 05m')
    expect(line.querySelector('.aq-marker')).toHaveStyle({ left: '80%' })
    expect(screen.queryByRole('slider')).toBeNull()
    expect(lineTooltip(window, 80, NOW)).toBe(
      `Current session: 72% used · limit 80% · resets 1h 05m (${formatResetAbsolute(window.resetsAt)})\nOpus: 72%`,
    )
    expect(lineTooltip({ ...window, resetsAt: undefined, breakdown: undefined }, 80, NOW)).toBe('Current session: 72% used · limit 80%')
  })

  it('moves a danger zone of 5% or less out of the track, after it', () => {
    const { rerender } = render(<QuotaLine window={{ ...window, kind: 'weekly', usedPct: 40 }} limit={95} animations showReset now={NOW} />)
    const line = screen.getByTestId('aq-line-weekly')
    const danger = line.querySelector('.aq-danger-value')
    expect(danger).toHaveTextContent('5%')
    expect(danger).toHaveClass('aq-danger-value-outside')
    // Its own grid cell right after the track, not positioned over the safe range.
    expect(line.querySelector('.aq-track')?.contains(danger ?? null)).toBe(false)
    expect(line.querySelector('.aq-track')?.nextElementSibling).toBe(danger)
    expect(danger?.getAttribute('style')).toBeNull()

    rerender(<QuotaLine window={{ ...window, kind: 'weekly', usedPct: 40 }} limit={94} animations showReset now={NOW} />)
    const inside = line.querySelector('.aq-danger-value')
    expect(inside).toHaveTextContent('6%')
    expect(inside).not.toHaveClass('aq-danger-value-outside')
    expect(line.querySelector('.aq-track')?.contains(inside ?? null)).toBe(true)
  })

  it('moves the limit with the keyboard and by dragging the marker', () => {
    const onLimitChange = vi.fn()
    const { rerender } = render(<QuotaLine window={window} limit={80} animations={false} showReset={false} now={NOW} onLimitChange={onLimitChange} />)
    const slider = screen.getByRole('slider', { name: 'Session (5h) limit' })
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    fireEvent.keyDown(slider, { key: 'ArrowUp', shiftKey: true })
    fireEvent.keyDown(slider, { key: 'Enter' })
    expect(onLimitChange.mock.calls).toEqual([[79], [85]])

    const track = slider.parentElement as HTMLElement
    track.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, right: 200, bottom: 10, height: 10, x: 0, y: 0, toJSON: () => ({}) })
    slider.setPointerCapture = vi.fn()
    let captured = false
    slider.hasPointerCapture = () => captured
    fireEvent.pointerMove(slider, { clientX: 100 })
    expect(onLimitChange).toHaveBeenCalledTimes(2)
    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 160 })
    captured = true
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 120 })
    expect(onLimitChange).toHaveBeenLastCalledWith(60)
    track.getBoundingClientRect = () => ({ left: 0, width: 0, top: 0, right: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 5 })
    expect(onLimitChange).toHaveBeenLastCalledWith(80)
    rerender(<QuotaLine window={{ ...window, usedPct: 10 }} limit={80} animations showReset={false} now={NOW} />)
    expect(screen.getByTestId('aq-line-session')).toHaveAttribute('data-animation', 'none')
  })
})

describe('QuotaPaneLines', () => {
  it('renders nothing without a detected, enabled agent', () => {
    const { container, rerender } = render(<QuotaPaneLines sessionId="none" />)
    expect(container).toBeEmptyDOMElement()
    seed({ config: { ...DEFAULT_QUOTA_CONFIG, enabled: false } })
    rerender(<QuotaPaneLines sessionId="s1" />)
    expect(screen.getByTestId('aq-monitor-off')).toHaveTextContent('Quota monitor off')
  })

  it('shows one line per enabled window without a redundant global badge', () => {
    seed({ config: { ...DEFAULT_QUOTA_CONFIG, display: { ...DEFAULT_QUOTA_CONFIG.display, lines: { session: true, weekly: false, monthly: true } } } })
    render(<QuotaPaneLines sessionId="s1" />)
    expect(screen.getByTestId('aq-line-session')).toBeInTheDocument()
    expect(screen.queryByTestId('aq-line-weekly')).toBeNull()
    expect(screen.queryByLabelText('Global limits')).toBeNull()
    expect(screen.getByTestId('aq-strip')).toHaveClass('aq-size-normal')
  })

  it('shows the agent icon right after the profile name', () => {
    seed()
    render(<QuotaPaneLines sessionId="s1" />)
    const name = screen.getByTestId('aq-strip').querySelector('.aq-meta-name')
    expect(name).toHaveTextContent('work')
    expect(name?.nextElementSibling?.tagName.toLowerCase()).toBe('svg')
    expect(name?.previousElementSibling).toBeNull()
  })

  it('shows a paused terminal and lets the user enable monitoring again', () => {
    seed()
    act(() => setOverride('s1:10:100', { enabled: false, suspendAtLimit: false }))
    render(<QuotaPaneLines sessionId="s1" />)
    expect(screen.getByTestId('aq-monitor-paused')).toHaveTextContent('Monitoring paused for this terminal')
    fireEvent.click(screen.getByRole('button', { name: 'Enable monitoring' }))
    expect(getQuotaState().overrides['s1:10:100']).toEqual({ suspendAtLimit: false })
  })

  it('reports reading and error states, dimming stale lines', () => {
    seed({ profiles: [profile(undefined)] })
    const { rerender } = render(<QuotaPaneLines sessionId="s1" />)
    expect(screen.getByText('Reading quota…')).toBeInTheDocument()
    seed({ profiles: [profile({ windows: [], fetchedAt: NOW, error: 'timeout', message: 'claude /usage timed out.' })] })
    rerender(<QuotaPaneLines sessionId="s1" />)
    expect(screen.getByText('claude /usage timed out.')).toBeInTheDocument()
    seed({ profiles: [profile({ windows: [], fetchedAt: NOW, error: 'timeout' }, { lastGood: reading(40) })] })
    rerender(<QuotaPaneLines sessionId="s1" />)
    expect(document.querySelector('.aq-stale')).not.toBeNull()
    seed({ profiles: [profile({ windows: [], fetchedAt: NOW, error: 'failed' })] })
    rerender(<QuotaPaneLines sessionId="s1" />)
    expect(screen.getByText('Quota unavailable')).toBeInTheDocument()
  })

  it('creates a sparse override when the marker moves, and shows the custom badge', () => {
    seed()
    render(<QuotaPaneLines sessionId="s1" />)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Session (5h) limit' }), { key: 'ArrowLeft' })
    expect(getQuotaState().overrides['s1:10:100']).toEqual({ limits: { session: 89 } })
    // The settings button carries the custom badge; the meta slot keeps only name and agent icon.
    const settings = screen.getByRole('button', { name: 'Quota limits for this terminal' })
    expect(settings).toHaveClass('aq-override')
    expect(settings).toHaveAttribute('title', 'Custom settings for this terminal')
    expect(document.querySelectorAll('.aq-meta svg')).toHaveLength(1)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Session (5h) limit' }), { key: 'ArrowRight' })
    expect(getQuotaState().overrides).toEqual({})
    expect(screen.getByRole('button', { name: 'Quota limits for this terminal' })).not.toHaveClass('aq-override')
  })

  it('toggles scheduled wake-up without waking the profile immediately', () => {
    seed()
    render(<QuotaPaneLines sessionId="s1" />)
    const wake = screen.getByRole('button', { name: 'Enable scheduled wake-up for this terminal' })
    expect(wake).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(wake)
    expect(getQuotaState().overrides['s1:10:100']).toMatchObject({ wake: { mode: 'afterReset' } })
    expect(wake).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Disable scheduled wake-up for this terminal' })).toHaveClass('text-theme-accent')
    const toggle = screen.getByRole('button', { name: 'Quota limits for this terminal' })
    fireEvent.click(toggle)
    expect(screen.getByRole('dialog', { name: 'Quota limits for this terminal' })).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not render pace glyph or warning icon in the terminal quota line', () => {
    seed()
    render(<QuotaPaneLines sessionId="s1" />)
    expect(screen.queryByLabelText(/Usage pace/)).toBeNull()
    expect(screen.getByText('5h')).toBeInTheDocument()
  })

  it('auto-hides a barely-used weekly window with a distant reset, noted on the session tooltip', () => {
    seed({ profiles: [profile(reading(40, 10))] }) // weekly 10% used, resets in 3 days
    render(<QuotaPaneLines sessionId="s1" />)
    expect(screen.queryByTestId('aq-line-weekly')).toBeNull()
    expect(screen.getByTestId('aq-line-session').getAttribute('title')).toContain('Weekly: 10% used (hidden)')
  })

  it('shows the weekly window once the auto-hide setting is off', () => {
    seed({
      profiles: [profile(reading(40, 10))],
      config: { ...DEFAULT_QUOTA_CONFIG, display: { ...DEFAULT_QUOTA_CONFIG.display, weeklyAutoHide: false } },
    })
    render(<QuotaPaneLines sessionId="s1" />)
    expect(screen.getByTestId('aq-line-weekly')).toBeInTheDocument()
  })

  it('shows the weekly window in a terminal whose "Show weekly quota" override is on', () => {
    seed({ profiles: [profile(reading(40, 10))] })
    render(<QuotaPaneLines sessionId="s1" />)
    expect(screen.queryByTestId('aq-line-weekly')).toBeNull()

    act(() => setOverride('s1:10:100', { showWeekly: true }))
    expect(screen.getByTestId('aq-line-weekly')).toBeInTheDocument()
  })

  it('offers "Show weekly quota" in the terminal popover and applies it as an override', () => {
    seed({ profiles: [profile(reading(40, 10))] })
    render(<QuotaPaneLines sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Quota limits for this terminal' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Always show the weekly quota line in this terminal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(getQuotaState().overrides['s1:10:100']).toEqual({ showWeekly: true })
    expect(screen.getByTestId('aq-line-weekly')).toBeInTheDocument()
  })

  it('names the profile by its launcher, hides a disabled wake button and marks a held agent', () => {
    seed({
      config: { ...DEFAULT_QUOTA_CONFIG, display: { ...DEFAULT_QUOTA_CONFIG.display, icons: { ...DEFAULT_QUOTA_CONFIG.display.icons, wakeButton: false } } },
      terminals: [terminal({ agent: 'codex', launcher: 'codex-alt', profileName: 'codex-alt' })],
      guards: { 's1:10:100': { phase: 'suspended', lastAttemptAt: NOW, risingCount: 0 } },
    })
    render(<QuotaPaneLines sessionId="s1" />)
    expect(screen.getByText('codex-alt')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /scheduled wake-up for this terminal/ })).toBeNull()
    expect(screen.getByLabelText('Suspended')).toBeInTheDocument()
  })
})

describe('SuspendedOverlay', () => {
  it('stays hidden while active', () => {
    seed()
    const { container } = render(<SuspendedOverlay sessionId="s1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('explains the freeze and lets the user hide the overlay without resuming', () => {
    seed({ guards: { 's1:10:100': { phase: 'guarding', lastAttemptAt: NOW, risingCount: 0, window: 'session', frozenPct: 91.4, resetsAt: NOW + 3_600_000 } } })
    const { rerender } = render(<SuspendedOverlay sessionId="s1" />)
    expect(screen.getByRole('alert')).toHaveTextContent('reached 91% of its session (5h) quota (limit 90%).')
    expect(screen.getByRole('alert')).toHaveTextContent('Checking that usage has stopped rising')
    fireEvent.click(screen.getByRole('button', { name: /Hide freeze overlay/ }))
    expect(screen.queryByTestId('aq-suspended')).toBeNull()

    act(() => seed({ guards: { 's1:10:100': { phase: 'suspended', lastAttemptAt: NOW, risingCount: 0, window: 'session', frozenPct: 91, resetsAt: NOW + 3_600_000 } } }))
    rerender(<SuspendedOverlay sessionId="s1" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Live countdown: resumes in 1h 00m.')
    expect(screen.queryByRole('button', { name: 'Resume now' })).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('navigate to Settings → Agent Quota')
    act(() => seed({ guards: { 's1:10:100': { phase: 'suspended', lastAttemptAt: NOW, risingCount: 0 } } }))
    expect(screen.getByRole('alert')).toHaveTextContent('Waiting for the quota to reset.')
    act(() => seed({ guards: { 's1:10:100': { phase: 'stopped', lastAttemptAt: NOW, risingCount: 0 } } }))
    expect(screen.getByRole('alert')).toHaveTextContent('Process stopped')
    expect(screen.getByRole('button', { name: /Hide freeze overlay/ })).toBeInTheDocument()
  })
})
