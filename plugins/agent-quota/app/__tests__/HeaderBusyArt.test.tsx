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

  it('renders loading art for slow tier when quota is low', () => {
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
    expect(art).toHaveClass('aq-busy-art-slow')
  })

  it('renders loading art for overshooting tier when quota is high', () => {
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
    expect(art).toHaveClass('aq-busy-art-overshooting')
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

  it('renders light mode artwork and applies custom artSize and artSpeed', () => {
    seed({
      config: {
        ...DEFAULT_QUOTA_CONFIG,
        display: {
          ...DEFAULT_QUOTA_CONFIG.display,
          customArtSession: true,
          animations: true,
          artSize: 'large',
          artSpeed: 'fast',
        },
      },
      terminals: [terminal()],
      profiles: [profile(reading(30, 30))],
    })
    render(<HeaderBusyArt sessionId="s1" darkMode={false} fallback={<span>dots</span>} />)
    const art = screen.getByRole('status')
    expect(art).toHaveClass('aq-art-size-large')
    expect(art).toHaveClass('aq-art-speed-fast')
    const img = art.querySelector('img')
    expect(img).toBeInTheDocument()
    expect(img?.getAttribute('src')).toBeTruthy()
  })

  it('falls back to default limit and normal size/speed when artSize and artSpeed are undefined', () => {
    seed({
      config: {
        ...DEFAULT_QUOTA_CONFIG,
        display: {
          ...DEFAULT_QUOTA_CONFIG.display,
          customArtSession: true,
          animations: true,
          artSize: undefined,
          artSpeed: undefined,
        },
      },
      terminals: [],
      profiles: [],
    })
    render(<HeaderBusyArt sessionId="missing" fallback={<span>dots</span>} />)
    const art = screen.getByRole('status')
    expect(art).toHaveAttribute('data-loading-tier', 'onTrack')
    expect(art).toHaveClass('aq-art-size-normal')
    expect(art).toHaveClass('aq-art-speed-normal')
  })
})
