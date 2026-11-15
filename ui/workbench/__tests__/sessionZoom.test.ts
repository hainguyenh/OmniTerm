import { beforeEach, describe, expect, it } from 'vitest'

import { PANE_ZOOM_MAX, PANE_ZOOM_MIN } from '../../utils/paneZoom'
import {
  AUTO_ZOOM_MIN,
  REFERENCE_PANE,
  autoZoom,
  effectiveZoom,
  hasZoom,
  parseStoredZoom,
  setZoomOverride,
  stepZoom,
  useSessionZoom,
  zoomKey,
} from '../layout/sessionZoom'

beforeEach(() => {
  useSessionZoom.setState({ overrides: {} })
})

describe('session zoom', () => {
  it('has no zoom below four panes and 100% there', () => {
    expect(['1', '2', '1+2'].map((key) => hasZoom(key as never))).toEqual([false, false, false])
    expect(autoZoom('2', { width: 400, height: 300 })).toBe(1)
  })

  it('shrinks grids in proportion to the pane size the window gives', () => {
    const wide = autoZoom('2x2', { width: REFERENCE_PANE.width * 2, height: REFERENCE_PANE.height * 2 })
    const narrow = autoZoom('2x2', { width: REFERENCE_PANE.width, height: REFERENCE_PANE.height })
    expect(wide).toBe(1)
    expect(narrow).toBe(AUTO_ZOOM_MIN)
    // A 2 x 2 grid in a 1200 x 800 window (editor area about 1090 x 850) stays readable.
    const laptop = autoZoom('2x2', { width: 1090, height: 850 })
    expect(laptop).toBeGreaterThanOrEqual(0.8)
    expect(laptop).toBeLessThan(1)
    expect(autoZoom('4x2', { width: 1600, height: 960 })).toBeLessThan(autoZoom('2x2', { width: 1600, height: 960 }))
  })

  it('stays inside the zoom range whatever the window is', () => {
    for (const key of ['2x2', '3x2', '4x2'] as const) {
      for (const size of [{ width: 100, height: 100 }, { width: 9000, height: 9000 }, null]) {
        const zoom = autoZoom(key, size)
        expect(zoom).toBeGreaterThanOrEqual(Math.max(PANE_ZOOM_MIN, AUTO_ZOOM_MIN))
        expect(zoom).toBeLessThanOrEqual(PANE_ZOOM_MAX)
      }
    }
  })

  it('lets the user override per preset, step it, return to 1:1 and back to automatic', () => {
    const area = { width: 1600, height: 960 }
    const auto = effectiveZoom('3x2', area, {})
    setZoomOverride('3x2', stepZoom(auto, -1))
    expect(effectiveZoom('3x2', area, useSessionZoom.getState().overrides)).toBeLessThan(auto)
    expect(effectiveZoom('2x2', area, useSessionZoom.getState().overrides)).toBe(autoZoom('2x2', area))
    setZoomOverride('3x2', 1)
    expect(effectiveZoom('3x2', area, useSessionZoom.getState().overrides)).toBe(1)
    setZoomOverride('3x2', null)
    expect(effectiveZoom('3x2', area, useSessionZoom.getState().overrides)).toBe(auto)
  })

  it('counts a hand-split layout as the preset that holds its panes', () => {
    expect(zoomKey('custom', 5)).toBe('3x2')
    expect(zoomKey('2x2', 4)).toBe('2x2')
  })

  it('drops invalid persisted zoom', () => {
    expect(parseStoredZoom({ '2x2': 0.7, '3x2': 5, '4x2': 'x', nope: 0.6 })).toEqual({ '2x2': 0.7 })
    expect(parseStoredZoom(null)).toEqual({})
  })
})
