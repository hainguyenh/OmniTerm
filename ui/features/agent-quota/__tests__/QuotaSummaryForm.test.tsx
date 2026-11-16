/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuotaConfig } from '../quotaConfig'

import { DEFAULT_QUOTA_CONFIG } from '../quotaConfig'
import { getQuotaState, resetQuotaStore } from '../quotaStore'
import { placementOf, withPlacement } from '../quotaPlacement'
import { QuotaSummaryForm } from '../QuotaSummaryForm'

beforeEach(() => resetQuotaStore())
afterEach(() => resetQuotaStore())

const config = (patch: Partial<QuotaConfig> = {}): QuotaConfig => ({ ...DEFAULT_QUOTA_CONFIG, ...patch })

describe('QuotaSummaryForm', () => {
  it('maps the Display choice onto the stored pin and footer flags', () => {
    expect(placementOf({ pinned: true, footer: false })).toBe('activity')
    expect(placementOf({ pinned: false, footer: true })).toBe('footer')
    expect(placementOf({ pinned: true, footer: true })).toBe('both')
    expect(placementOf({ pinned: false, footer: false })).toBe('hidden')
    for (const placement of ['activity', 'footer', 'both', 'hidden'] as const) {
      expect(placementOf(withPlacement({ pinned: false, footer: false }, placement))).toBe(placement)
    }
  })

  it('edits placement, animations and providers in the draft', () => {
    const onChange = vi.fn()
    const draft = config({ pinned: true, footer: false })
    render(<QuotaSummaryForm draft={draft} onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent quota display' }), { target: { value: 'both' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ pinned: true, footer: true }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Show animations/ }))
    expect(onChange.mock.lastCall?.[0].display.animations).toBe(!draft.display.animations)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Codex' }))
    expect(onChange.mock.lastCall?.[0].agents.codex.enabled).toBe(!draft.agents.codex.enabled)
  })

  it('turns the at-limit guard off only after the danger confirmation', () => {
    const onChange = vi.fn()
    const draft = config()
    const monitored = Object.values(draft.agents).filter((agent) => agent.enabled)
    expect(monitored.length).toBeGreaterThan(0)
    render(<QuotaSummaryForm draft={draft} onChange={onChange} />)
    const guard = screen.getByRole('checkbox', { name: /Suspend the agent at its limit/ })
    expect(guard).toBeChecked()
    fireEvent.click(guard)
    expect(onChange).not.toHaveBeenCalled()
    getQuotaState().confirm?.onConfirm()
    const next = onChange.mock.lastCall?.[0] as QuotaConfig
    for (const agent of Object.values(next.agents)) if (agent.enabled) expect(agent.suspendAtLimit).toBe(false)
  })
})
