/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'

import { DEFAULT_QUOTA_CONFIG } from '../quotaConfig'
import { resetQuotaStore } from '../quotaStore'
import { HeaderBusyArt } from '../HeaderBusyArt'
import { profile, reading, seed, terminal } from './quotaFixtures'

describe('HeaderBusyArt', () => {
  beforeEach(() => {
    resetQuotaStore()
  })

  it('renders fallback when customArtSession or animations is disabled', () => {
    seed({
      config: {
        ...DEFAULT_QUOTA_CONFIG,
        display: { ...DEFAULT_QUOTA_CONFIG.display, customArtSession: false, animations: true },
      },
    })
    render(<HeaderBusyArt sessionId="s1" fallback={<span data-testid="fallback">dots</span>} />)
    expect(screen.getByTestId('fallback')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders loading art without flame when quota is under 90%', () => {
    seed({
      config: {
        ...DEFAULT_QUOTA_CONFIG,
        display: { ...DEFAULT_QUOTA_CONFIG.display, customArtSession: true, animations: true },
      },
      terminals: [terminal()],
      profiles: [profile(reading(30, 30))],
    })
    render(<HeaderBusyArt sessionId="s1" fallback={<span>dots</span>} />)
    const art = screen.getByRole('status')
    expect(art).toHaveAttribute('data-loading-tier', 'slow')
    expect(art).not.toHaveClass('aq-busy-art-blazing')
    expect(art).not.toHaveAttribute('data-blazing')
    expect(screen.queryByTestId('aq-art-blaze')).toBeNull()
  })

  it('renders blazing flame effect when session quota reaches 90%', () => {
    seed({
      config: {
        ...DEFAULT_QUOTA_CONFIG,
        display: { ...DEFAULT_QUOTA_CONFIG.display, customArtSession: true, animations: true },
      },
      terminals: [terminal()],
      profiles: [profile(reading(90, 40))],
    })
    render(<HeaderBusyArt sessionId="s1" fallback={<span>dots</span>} />)
    const art = screen.getByRole('status')
    expect(art).toHaveAttribute('data-loading-tier', 'overshooting')
    expect(art).toHaveClass('aq-busy-art-blazing')
    expect(art).toHaveAttribute('data-blazing', 'true')

    const blaze = screen.getByTestId('aq-art-blaze')
    expect(blaze).toBeInTheDocument()
    expect(blaze.querySelector('.aq-art-fire-trail')).toBeInTheDocument()
    expect(blaze.querySelector('.aq-art-fire-runner')).toBeInTheDocument()
  })

  it('renders blazing flame effect when session quota reaches 90% of user limit', () => {
    seed({
      config: {
        ...DEFAULT_QUOTA_CONFIG,
        agents: {
          ...DEFAULT_QUOTA_CONFIG.agents,
          claude: {
            ...DEFAULT_QUOTA_CONFIG.agents.claude,
            limits: { session: 80, weekly: 90, monthly: 95 },
          },
        },
        display: { ...DEFAULT_QUOTA_CONFIG.display, customArtSession: true, animations: true },
      },
      terminals: [terminal()],
      profiles: [profile(reading(72, 30))], // 72 is 90% of 80 limit
    })
    render(<HeaderBusyArt sessionId="s1" fallback={<span>dots</span>} />)
    const art = screen.getByRole('status')
    expect(art).toHaveClass('aq-busy-art-blazing')
    expect(art).toHaveAttribute('data-blazing', 'true')
    expect(screen.getByTestId('aq-art-blaze')).toBeInTheDocument()
  })

  it('renders blazing flame effect when another quota window reaches >= 90%', () => {
    seed({
      config: {
        ...DEFAULT_QUOTA_CONFIG,
        display: { ...DEFAULT_QUOTA_CONFIG.display, customArtSession: true, animations: true },
      },
      terminals: [terminal()],
      profiles: [profile(reading(50, 93))], // session is 50%, weekly is 93%
    })
    render(<HeaderBusyArt sessionId="s1" fallback={<span>dots</span>} />)
    const art = screen.getByRole('status')
    expect(art).toHaveClass('aq-busy-art-blazing')
    expect(art).toHaveAttribute('data-blazing', 'true')
    expect(screen.getByTestId('aq-art-blaze')).toBeInTheDocument()
  })

  it('sets distance factor style on the art element when container width changes', () => {
    let resizeCb: (() => void) | undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resizeCb = cb
        }
        observe = vi.fn()
        disconnect = vi.fn()
      },
    )

    seed({
      config: {
        ...DEFAULT_QUOTA_CONFIG,
        display: { ...DEFAULT_QUOTA_CONFIG.display, customArtSession: true, animations: true },
      },
      terminals: [terminal()],
      profiles: [profile(reading(50, 40))],
    })

    const { container } = render(<HeaderBusyArt sessionId="s1" fallback={<span>dots</span>} />)
    const art = container.querySelector('.aq-busy-art') as HTMLElement
    expect(art).toBeInTheDocument()

    vi.spyOn(art, 'getBoundingClientRect').mockReturnValue({ width: 400 } as DOMRect)
    act(() => {
      resizeCb?.()
    })

    expect(art.style.getPropertyValue('--aq-art-distance-factor')).toBeTruthy()
    vi.unstubAllGlobals()
  })
})
