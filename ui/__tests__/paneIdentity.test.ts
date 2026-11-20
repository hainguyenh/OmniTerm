import { describe, expect, it } from 'vitest'

import { PANE_IDENTITY } from '../paneIdentity'

describe('PANE_IDENTITY', () => {
  it('has one entry per pane of the largest layout', () => {
    expect(PANE_IDENTITY).toHaveLength(8)
  })

  it('gives every entry a distinct shape, colour and label', () => {
    expect(new Set(PANE_IDENTITY.map(p => p.color)).size).toBe(PANE_IDENTITY.length)
    expect(new Set(PANE_IDENTITY.map(p => p.icon)).size).toBe(PANE_IDENTITY.length)
    expect(new Set(PANE_IDENTITY.map(p => p.label)).size).toBe(PANE_IDENTITY.length)
  })

  it('uses literal hexes, so a session keeps its colour across themes', () => {
    for (const pane of PANE_IDENTITY) expect(pane.color).toMatch(/^#[0-9a-f]{6}$/)
  })
})
