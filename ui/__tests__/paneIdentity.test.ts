import { describe, it, expect, beforeEach } from 'vitest'
import { PANE_IDENTITY, isDifferentPaneColors, paneIdentity, paneSurfaceColor, setDifferentPaneColors, withAlpha } from '../paneIdentity'

beforeEach(() => {
  setDifferentPaneColors(true)
})

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

  it('uses theme accent color for all panes when differentPaneColors is disabled', () => {
    expect(isDifferentPaneColors()).toBe(true)
    setDifferentPaneColors(false)
    expect(isDifferentPaneColors()).toBe(false)
    expect(paneIdentity(0).color).toBe('var(--theme-accent)')
    expect(paneIdentity(1).color).toBe('var(--theme-accent)')
    // shape is still preserved
    expect(paneIdentity(0).icon).toBe(PANE_IDENTITY[0].icon)
    expect(paneIdentity(1).icon).toBe(PANE_IDENTITY[1].icon)
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

  it('formats color-mix for CSS variables', () => {
    expect(withAlpha('var(--theme-accent)', 0.18)).toBe('color-mix(in srgb, var(--theme-accent) 18%, transparent)')
    expect(withAlpha('var(--theme-accent)', 0.55)).toBe('color-mix(in srgb, var(--theme-accent) 55%, transparent)')
  })
})

describe('paneSurfaceColor', () => {
  it('uses matching focused and docked title tints', () => {
    const identity = PANE_IDENTITY[0]
    expect(paneSurfaceColor(identity, true)).toBe('#7aa2f72e')
    expect(paneSurfaceColor(identity, false)).toBe('#7aa2f71a')
  })
})
