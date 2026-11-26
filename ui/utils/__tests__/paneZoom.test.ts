import { describe, expect, it } from 'vitest'

import { clampPaneZoom, defaultPaneZoom, zoomedFontSize } from '../paneZoom'

describe('paneZoom', () => {
  it('starts at 100% up to four panes, then zooms out', () => {
    expect(([1, 2, 3, 4] as const).map(m => defaultPaneZoom(m))).toEqual([1, 1, 1, 1])
    expect([5, 6].map(m => defaultPaneZoom(m as 5 | 6))).toEqual([0.85, 0.85])
    expect([7, 8].map(m => defaultPaneZoom(m as 7 | 8))).toEqual([0.7, 0.7])
  })

  it('snaps to 5% steps inside 50% to 100%', () => {
    expect(clampPaneZoom(0.73)).toBe(0.75)
    expect(clampPaneZoom(0.2)).toBe(0.5)
    expect(clampPaneZoom(1.4)).toBe(1)
  })

  it('scales the font but keeps it legible', () => {
    expect(zoomedFontSize(14, 0.7)).toBe(10)
    expect(zoomedFontSize(14, 1)).toBe(14)
    expect(zoomedFontSize(10, 0.5)).toBe(8)
    expect(zoomedFontSize(6, 1)).toBe(6)
  })
})
