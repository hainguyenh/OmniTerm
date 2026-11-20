/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FROZEN_OVERLAY_EVENT } from '../frozenOverlayEvents'
import { FrozenSessionStatus } from '../FrozenSessionStatus'
import { getQuotaState, resetQuotaStore } from '../quotaStore'
import { NOW, seed, terminal } from './quotaFixtures'

describe('FrozenSessionStatus', () => {
  beforeEach(() => {
    resetQuotaStore()
  })

  it('renders nothing when there is no guard or phase is active', () => {
    seed({ terminals: [terminal({ sessionId: 's1', instanceKey: 'inst-1' })], guards: {} })
    const { container, rerender } = render(<FrozenSessionStatus sessionId="s1" />)
    expect(container.firstChild).toBeNull()

    // Unknown sessionId
    rerender(<FrozenSessionStatus sessionId="unknown" />)
    expect(container.firstChild).toBeNull()

    // Active guard
    seed({
      terminals: [terminal({ sessionId: 's1', instanceKey: 'inst-1' })],
      guards: { 'inst-1': { phase: 'active', lastAttemptAt: NOW, risingCount: 0 } },
    })
    rerender(<FrozenSessionStatus sessionId="s1" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders stopped state with ShieldAlert icon and no countdown', () => {
    seed({
      terminals: [terminal({ sessionId: 's1', instanceKey: 'inst-1' })],
      guards: { 'inst-1': { phase: 'stopped', lastAttemptAt: NOW, risingCount: 0 } },
    })
    render(<FrozenSessionStatus sessionId="s1" />)
    const btn = screen.getByTestId('aq-frozen-status')
    expect(btn).toHaveAttribute('aria-label', 'Process stopped by quota guard')
    expect(btn).toHaveClass('text-theme-error')
    expect(btn).toHaveTextContent('Stopped')
    expect(btn).not.toHaveTextContent('resumes in')
  })

  it('renders guarding phase with Snowflake icon and no countdown', () => {
    seed({
      terminals: [terminal({ sessionId: 's1', instanceKey: 'inst-1' })],
      guards: { 'inst-1': { phase: 'guarding', lastAttemptAt: NOW, risingCount: 0 } },
    })
    render(<FrozenSessionStatus sessionId="s1" />)
    const btn = screen.getByTestId('aq-frozen-status')
    expect(btn).toHaveAttribute('aria-label', 'Process frozen')
    expect(btn).toHaveClass('text-theme-warning')
    expect(btn).toHaveTextContent('Frozen')
    expect(btn).not.toHaveTextContent('resumes in')
  })

  it('renders suspended phase with countdown and dispatches event on click', () => {
    seed({
      terminals: [terminal({ sessionId: 's1', instanceKey: 'inst-1' })],
      guards: {
        'inst-1': {
          phase: 'suspended',
          lastAttemptAt: NOW,
          resetsAt: NOW + 30 * 60 * 1000,
          risingCount: 0,
        },
      },
    })

    const eventListener = vi.fn()
    window.addEventListener(FROZEN_OVERLAY_EVENT, eventListener)

    render(<FrozenSessionStatus sessionId="s1" />)
    const btn = screen.getByTestId('aq-frozen-status')
    expect(btn).toHaveAttribute('aria-label', 'Process frozen')
    expect(btn).toHaveTextContent('Frozen')
    expect(btn).toHaveTextContent('resumes in')

    fireEvent.click(btn)
    expect(eventListener).toHaveBeenCalled()
    const customEvent = eventListener.mock.calls[0][0] as CustomEvent
    expect(customEvent.detail).toEqual({ sessionId: 's1' })
    expect(getQuotaState().reviewSessionId).toBe('s1')

    window.removeEventListener(FROZEN_OVERLAY_EVENT, eventListener)
  })
})
