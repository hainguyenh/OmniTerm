/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { footerChips } from '../footerChips'
import { QuotaFooterChips } from '../QuotaFooterChips'
import { DEFAULT_QUOTA_CONFIG } from '../quotaConfig'
import { getQuotaState } from '../quotaStore'
import { profile, reading, seed, terminal } from './quotaFixtures'

const footerOn = { ...DEFAULT_QUOTA_CONFIG, footer: true }

describe('footerChips', () => {
  it('builds one chip per profile from the session window', () => {
    const state = { terminals: { s1: terminal(), s2: terminal({ sessionId: 's2', instanceKey: 's2:11:100' }) }, profiles: { 'claude:c:\\p\\work': profile(reading(42)) }, config: footerOn }
    const chips = footerChips(state, () => false)
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({ tag: 'Cl', profileName: 'work', usedPct: 42, alert: false })
  })

  it('has a chip without a reading and flags a profile past its limit or held', () => {
    const none = footerChips({ terminals: { s1: terminal() }, profiles: {}, config: footerOn }, () => false)
    expect(none[0]).toMatchObject({ usedPct: null, alert: false })
    const over = footerChips({ terminals: { s1: terminal() }, profiles: { 'claude:c:\\p\\work': profile(reading(95)) }, config: footerOn }, () => false)
    expect(over[0]?.alert).toBe(true)
    const held = footerChips({ terminals: { s1: terminal() }, profiles: { 'claude:c:\\p\\work': profile(reading(10)) }, config: footerOn }, () => true)
    expect(held[0]?.alert).toBe(true)
  })
})

describe('QuotaFooterChips', () => {
  beforeEach(() => seed({ config: footerOn }))

  it('renders a chip with the used percent and opens quick settings on click', () => {
    render(<QuotaFooterChips />)
    const chip = screen.getByRole('button', { name: /Cl/ })
    expect(chip.textContent).toContain('40%')
    fireEvent.click(chip)
    expect(getQuotaState().quickOpen).toBe(true)
  })

  it('renders nothing when the footer mode is off, the plugin is absent or the plugin is disabled', () => {
    seed({ config: DEFAULT_QUOTA_CONFIG })
    const first = render(<QuotaFooterChips />)
    expect(first.container.firstChild).toBeNull()
    first.unmount()

    seed({ config: footerOn, available: false })
    const second = render(<QuotaFooterChips />)
    expect(second.container.firstChild).toBeNull()
    second.unmount()

    seed({ config: { ...footerOn, enabled: false } })
    const third = render(<QuotaFooterChips />)
    expect(third.container.firstChild).toBeNull()
  })
})
