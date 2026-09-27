/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { QuotaAgentHeaderIndicator } from '../QuotaAgentHeaderIndicator'
import { DEFAULT_QUOTA_CONFIG } from '../quotaConfig'
import { resetQuotaStore, updateQuota } from '../quotaStore'
import { profile, reading, seed } from './quotaFixtures'

beforeEach(() => resetQuotaStore())
afterEach(() => resetQuotaStore())

describe('QuotaAgentHeaderIndicator', () => {
  it('uses the configured loading artwork while a quota read is in flight', () => {
    seed({ profiles: [profile(undefined, { fetching: true })] })
    render(<QuotaAgentHeaderIndicator sessionId="s1" loadingArtUrl="blob:quota-loading" />)
    expect(screen.getByRole('status', { name: 'Loading work quota' })).toBeInTheDocument()
    expect(screen.getByRole('status').querySelector('img')).toHaveAttribute('src', 'blob:quota-loading')
  })

  it('uses the fast dark-mode artwork while an agent is processing', () => {
    seed({ profiles: [profile(reading(70))] })
    render(<QuotaAgentHeaderIndicator sessionId="s1" busy darkMode />)
    const status = screen.getByRole('status', { name: 'Processing · fast burn' })
    expect(status).toHaveAttribute('data-loading-tier', 'fast')
    expect(status.querySelector('img')).toHaveAttribute('src')
  })

  it('uses custom session art only when the display toggle is enabled', async () => {
    seed({ config: { ...DEFAULT_QUOTA_CONFIG, display: { ...DEFAULT_QUOTA_CONFIG.display, customArtSession: true } } })
    render(
      <QuotaAgentHeaderIndicator sessionId="s1" busy darkMode={false} sessionArtUrl="blob:session-light" />,
    )
    const custom = screen.getByRole('status', { name: 'Processing · slow burn' })
    expect(custom).toHaveAttribute('data-art-source', 'custom')
    expect(custom.querySelector('img')).toHaveAttribute('src', 'blob:session-light')

    await act(async () => updateQuota((state) => ({
      ...state,
      config: { ...state.config, display: { ...state.config.display, customArtSession: false } },
    })))
    expect(screen.getByRole('status', { name: 'Processing · slow burn' })).toHaveAttribute('data-art-source', 'default')
    expect(screen.getByRole('status', { name: 'Processing · slow burn' }).querySelector('img')).not.toHaveAttribute('src', 'blob:session-light')
  })

  it('keeps the converted activity artwork visible before quota detects the terminal', () => {
    seed({ terminals: [] })
    render(<QuotaAgentHeaderIndicator sessionId="unknown" busy darkMode={false} />)
    const status = screen.getByRole('status', { name: 'Running process' })
    expect(status).toHaveAttribute('data-loading-tier', 'onTrack')
    expect(status.querySelector('img')).toHaveAttribute('src')
  })

  it('keeps a recognizable brand icon when quota detection is unavailable', () => {
    seed({ terminals: [] })
    render(<QuotaAgentHeaderIndicator sessionId="missing" agentName="Copilot CLI" />)
    expect(screen.getByRole('img', { name: 'Copilot CLI agent' })).toBeInTheDocument()
  })
})
