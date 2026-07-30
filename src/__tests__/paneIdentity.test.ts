import { describe, it, expect } from 'vitest'
import { PANE_IDENTITY, paneIdentity, withAlpha } from '../paneIdentity'

describe('PANE_IDENTITY', () => {
  it('covers every pane of the largest layout', () => {
    // MAX_PLANES in MainLayout: the panes array is always this long.
    expect(PANE_IDENTITY).toHaveLength(8)
  })

  it('gives every pane a distinct shape and a distinct colour', () => {
    expect(new Set(PANE_IDENTITY.map(p => p.color)).size).toBe(PANE_IDENTITY.length)
    expect(new Set(PANE_IDENTITY.map(p => p.icon)).size).toBe(PANE_IDENTITY.length)
    expect(new Set(PANE_IDENTITY.map(p => p.label)).size).toBe(PANE_IDENTITY.length)
  })

  it('uses literal hexes, so a pane keeps its colour across themes', () => {
    for (const pane of PANE_IDENTITY) expect(pane.color).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('paneIdentity', () => {
  it('maps an index to its entry', () => {
    expect(paneIdentity(0)).toBe(PANE_IDENTITY[0])
    expect(paneIdentity(7)).toBe(PANE_IDENTITY[7])
  })

  it('never returns undefined for an out-of-range index', () => {
    // A shrinking layout can hand over a stale index; a blank tab would be worse than a wrapped one.
    for (const i of [-1, 8, 99, 1.7]) expect(paneIdentity(i)).toBeDefined()
  })
})

describe('withAlpha', () => {
  it('appends an 8-digit alpha channel', () => {
    expect(withAlpha('#7aa2f7', 1)).toBe('#7aa2f7ff')
    expect(withAlpha('#7aa2f7', 0)).toBe('#7aa2f700')
    expect(withAlpha('#7aa2f7', 0.55)).toBe('#7aa2f78c')
  })

  it('clamps out-of-range alphas rather than emitting invalid CSS', () => {
    expect(withAlpha('#7aa2f7', 5)).toBe('#7aa2f7ff')
    expect(withAlpha('#7aa2f7', -2)).toBe('#7aa2f700')
  })
})
