/**
 * Pane geometry: the panes must tile the area exactly, and a dragged boundary must move the two panes
 * that meet at it — and nothing else.
 */
import { describe, it, expect } from 'vitest'
import {
  clampFraction, fractionFromPointer, paneDividers, paneOrder, paneRect, toRatios, MIN_FRACTION, DEFAULT_RATIOS,
} from '../paneLayout'
import type { LayoutMode } from '../themes'

/** Read a percentage back out of a style value. */
const num = (v: unknown): number => parseFloat(String(v))

describe('paneRect', () => {
  it('fills the area with a single pane', () => {
    expect(paneRect(0, 1)).toEqual({ left: '0%', top: '0%', width: '100%', height: '100%' })
  })

  it('splits two columns at the main ratio', () => {
    const ratios = { main: 0.3, cross: 0.5 }
    const [a, b] = [paneRect(0, 2, 'left', 'columns', ratios), paneRect(1, 2, 'left', 'columns', ratios)]
    expect(num(a.width)).toBeCloseTo(30)
    expect(num(b.left)).toBeCloseTo(30)
    expect(num(b.width)).toBeCloseTo(70)
    // Full height either way — a columns split never touches the vertical extent.
    expect(a.height).toBe('100%')
    expect(b.height).toBe('100%')
  })

  it('splits two rows at the main ratio', () => {
    const ratios = { main: 0.75, cross: 0.5 }
    const [a, b] = [paneRect(0, 2, 'left', 'rows', ratios), paneRect(1, 2, 'left', 'rows', ratios)]
    expect(num(a.height)).toBeCloseTo(75)
    expect(num(b.top)).toBeCloseTo(75)
    expect(num(b.height)).toBeCloseTo(25)
    expect(a.width).toBe('100%')
  })

  /** Every 3-pane arrangement must tile the area: no gap, no overlap, whatever the ratios. */
  it.each(['left', 'right', 'top'] as const)('tiles the area exactly with three panes (%s)', style => {
    const ratios = { main: 0.62, cross: 0.28 }
    const rects = [0, 1, 2].map(i => paneRect(i, 3, style, 'columns', ratios))
    const area = rects.reduce((sum, r) => sum + num(r.width) * num(r.height), 0)
    expect(area).toBeCloseTo(100 * 100, 1)

    // And the stacked pair meets exactly at `cross`, with the full pane spanning its own axis.
    const [main, first, second] = rects
    if (style === 'top') {
      expect(num(main.height)).toBeCloseTo(62)
      expect(num(first.width) + num(second.width)).toBeCloseTo(100)
      expect(num(second.left)).toBeCloseTo(28)
    } else {
      expect(num(main.width)).toBeCloseTo(62)
      expect(num(main.height)).toBeCloseTo(100)
      expect(num(first.height) + num(second.height)).toBeCloseTo(100)
      expect(num(second.top)).toBeCloseTo(28)
    }
  })

  it('mirrors the full-height pane to the right edge', () => {
    const ratios = { main: 0.4, cross: 0.5 }
    expect(num(paneRect(0, 3, 'right', 'columns', ratios).left)).toBeCloseTo(60)
    expect(num(paneRect(1, 3, 'right', 'columns', ratios).left)).toBeCloseTo(0)
  })

  it.each([5, 7] as LayoutMode[])('uses one dominant pane and a complete sub-grid for %i panes', mode => {
    const ratios = { main: 0.4, cross: 0.5 }
    for (const style of ['left', 'top'] as const) {
      const rects = Array.from({ length: mode }, (_, i) => paneRect(i, mode, style, 'columns', ratios))
      expect(rects.reduce((s, r) => s + num(r.width) * num(r.height), 0)).toBeCloseTo(100 * 100, 0)
      if (style === 'left') {
        expect(num(rects[0].width)).toBeCloseTo(40)
        expect(num(rects[0].height)).toBeCloseTo(100)
        expect(num(rects[1].left)).toBeCloseTo(40)
      } else {
        expect(num(rects[0].width)).toBeCloseTo(100)
        expect(num(rects[0].height)).toBeCloseTo(40)
        expect(num(rects[1].top)).toBeCloseTo(40)
      }
    }
  })

  it.each([4, 5, 6, 7, 8] as LayoutMode[])('supports custom boundaries in the %i-pane grid', mode => {
    const skewed = { main: 0.2, cross: 0.8, columns: mode <= 5 ? [0.3, 0.7].slice(0, mode === 4 ? 1 : 2) : mode === 6 ? [0.2, 0.7] : [0.2, 0.5, 0.8], rows: [0.65] }
    const rects = Array.from({ length: mode }, (_, i) => paneRect(i, mode, 'left', 'columns', skewed))
    expect(rects.reduce((s, r) => s + num(r.width) * num(r.height), 0)).toBeCloseTo(100 * 100, 0)
    expect(num(rects[0].width)).toBeCloseTo(mode === 4 ? 30 : 20)
    expect(num(rects[0].height)).toBeCloseTo(mode === 5 || mode === 7 ? 100 : 65)
  })

  it('orders panes by their window positions', () => {
    expect(paneOrder(3, 'right')).toEqual([1, 0, 2])
    expect(paneOrder(3, 'top')).toEqual([0, 1, 2])
    expect(paneOrder(2, 'left', 'rows')).toEqual([0, 1])
    expect(paneOrder(4)).toEqual([0, 1, 2, 3])
  })
})

describe('clampFraction', () => {
  it('keeps a pane from being dragged away entirely', () => {
    expect(clampFraction(0)).toBe(MIN_FRACTION)
    expect(clampFraction(1)).toBe(1 - MIN_FRACTION)
    expect(clampFraction(-5)).toBe(MIN_FRACTION)
    expect(clampFraction(0.42)).toBe(0.42)
  })

  it('falls back to an even split for anything that is not a real number', () => {
    expect(clampFraction(NaN)).toBe(0.5)
    expect(clampFraction(Infinity)).toBe(0.5)
  })
})

describe('toRatios', () => {
  it('defaults when settings predate the feature', () => {
    expect(toRatios(undefined)).toEqual(DEFAULT_RATIOS)
    expect(toRatios(null)).toEqual(DEFAULT_RATIOS)
    expect(toRatios({ main: 0.7 })).toEqual({ main: 0.7, cross: 0.5 })
  })

  /** A hand-edited or corrupt settings file must not produce a pane with no area. */
  it('clamps saved values', () => {
    expect(toRatios({ main: 0.99, cross: -1 })).toEqual({ main: 1 - MIN_FRACTION, cross: MIN_FRACTION })
  })
})

describe('paneDividers', () => {
  it('offers one boundary for two panes and two for three', () => {
    expect(paneDividers(2, 'left', 'columns').map(d => d.key)).toEqual(['main'])
    expect(paneDividers(3, 'left', 'columns').map(d => d.key)).toEqual(['main', 'cross'])
  })

  it('offers no divider for a single pane and all boundaries for grids', () => {
    expect(paneDividers(1)).toEqual([])
    expect(paneDividers(4).map(d => d.key)).toEqual(['column-1', 'row-1'])
    expect(paneDividers(5).map(d => d.key)).toEqual(['main', 'column-1', 'row-1'])
    expect(paneDividers(6).map(d => d.key)).toEqual(['column-1', 'column-2', 'row-1'])
    expect(paneDividers(7).map(d => d.key)).toEqual(['main', 'column-1', 'column-2', 'row-1'])
    expect(paneDividers(8).map(d => d.key)).toEqual(['column-1', 'column-2', 'column-3', 'row-1'])
  })

  it('orients the boundary along the split', () => {
    expect(paneDividers(2, 'left', 'columns')[0].axis).toBe('x')
    expect(paneDividers(2, 'left', 'rows')[0].axis).toBe('y')
    // 3-pane: the outer split and the stacked split always run across each other.
    const [main, cross] = paneDividers(3, 'left', 'columns')
    expect(main.axis).toBe('x')
    expect(cross.axis).toBe('y')
  })

  /** The stacked-pair boundary spans only that pair, so it cannot be mistaken for the outer split. */
  it('confines the stacked boundary to the stacked half', () => {
    const [, cross] = paneDividers(3, 'left', 'columns', { main: 0.6, cross: 0.5 })
    expect(num(cross.style.left)).toBeCloseTo(60)
    expect(num(cross.style.width)).toBeCloseTo(40)

    const [, mirrored] = paneDividers(3, 'right', 'columns', { main: 0.6, cross: 0.5 })
    expect(num(mirrored.style.left)).toBeCloseTo(0)
    expect(num(mirrored.style.width)).toBeCloseTo(40)
  })

  it('keeps grid dividers inside the minimum size of neighboring panes', () => {
    const [first, second] = paneDividers(6, 'left', 'columns', { main: .5, cross: .5, columns: [.2, .7], rows: [.6] })
    expect(first.minFraction).toBeCloseTo(MIN_FRACTION)
    expect(first.maxFraction).toBeCloseTo(.55)
    expect(second.minFraction).toBeCloseTo(.35)
    expect(second.maxFraction).toBeCloseTo(1 - MIN_FRACTION)
  })
})

describe('fractionFromPointer', () => {
  it('measures the pointer against the pane area, not the window', () => {
    // A 400px-wide area starting 100px in: a pointer at 300px is halfway across it.
    expect(fractionFromPointer(300, 100, 400)).toBeCloseTo(0.5)
    expect(fractionFromPointer(200, 100, 400)).toBeCloseTo(0.25)
  })

  /** The mirrored layout measures its main pane from the right edge; without inverting, the divider
   *  moved away from the cursor. */
  it('inverts for a boundary measured from the far edge', () => {
    expect(fractionFromPointer(200, 100, 400, true)).toBeCloseTo(0.75)
  })

  it('clamps and survives a zero-size area', () => {
    expect(fractionFromPointer(0, 100, 400)).toBe(MIN_FRACTION)
    expect(fractionFromPointer(50, 0, 0)).toBe(0.5)
  })
})
