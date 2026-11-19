/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  dock: 'stripL' as string,
  open: false,
  toggle: vi.fn(),
  groups: [] as unknown[],
}))

vi.mock('../useQuotaGroups', () => ({ useQuotaGroups: () => ({ sessionId: null, active: null, groups: state.groups }) }))
vi.mock('../quotaDockState', () => ({
  useQuotaDock: () => state.dock,
  useQuotaPopup: (select: (s: { open: boolean }) => unknown) => select({ open: state.open }),
  toggleQuotaPopup: () => state.toggle(),
}))
vi.mock('../quotaWorkbench.css', () => ({}))

import { QuotaStripVertical } from '../../QuotaStripVertical'

const group = (agent: string, tag: string, pct: number | null, active = false) => ({
  agent,
  name: agent,
  tag,
  active,
  profiles: [],
  shown: { key: agent, name: 'work', pct, detail: '5h window', active },
})

describe('QuotaStripVertical', () => {
  afterEach(cleanup)

  it('shows one ring per agent on the docked stripe, with its percentage and tag', () => {
    state.groups = [group('claude', 'Cl', 42, true), group('codex', 'Cx', null)]
    render(<QuotaStripVertical side="left" />)
    const rings = screen.getAllByTestId('quota-ring')
    expect(rings).toHaveLength(2)
    expect(rings[0]?.dataset.pct).toBe('42')
    expect(rings[0]?.textContent).toBe('42')
    expect(rings[1]?.textContent).toBe('–')
    // A ring without a reading draws only its track.
    expect(rings[1]?.querySelectorAll('circle')).toHaveLength(1)
    expect(screen.getByText('Cl')).toBeTruthy()
    // Block elements inside a button are invalid HTML and lay out unreliably on a stripe.
    expect(screen.getByTestId('quota-strip-vertical').querySelector('div')).toBeNull()
  })

  it('opens the details popup on click and stays off the other stripe', () => {
    state.groups = [group('claude', 'Cl', 10)]
    const { rerender } = render(<QuotaStripVertical side="left" />)
    fireEvent.click(screen.getByTestId('quota-strip-vertical'))
    expect(state.toggle).toHaveBeenCalled()
    rerender(<QuotaStripVertical side="right" />)
    expect(screen.queryByTestId('quota-strip-vertical')).toBeNull()
  })
})
