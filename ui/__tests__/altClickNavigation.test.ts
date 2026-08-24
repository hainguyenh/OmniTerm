import { describe, expect, it } from 'vitest'
import { altClickArrows, buildArrowBurst, cellFromPointer } from '../terminal/altClickNavigation'

describe('buildArrowBurst', () => {
  it('emits right/down arrows with the CSI default when DECCKM is off', () => {
    expect(buildArrowBurst({ col: 0, row: 0 }, { col: 3, row: 2 }, false)).toBe(
      '\x1b[C\x1b[C\x1b[C\x1b[B\x1b[B',
    )
  })

  it('uses the SS3 application-cursor form when DECCKM is on', () => {
    expect(buildArrowBurst({ col: 5, row: 5 }, { col: 4, row: 4 }, true)).toBe('\x1bOD\x1bOA')
  })

  it('caps each axis so a far jump cannot flood the PTY', () => {
    const burst = buildArrowBurst({ col: 0, row: 0 }, { col: 5000, row: 0 }, false)
    expect(burst).toBe('\x1b[C'.repeat(40))
  })

  it('returns an empty string when no movement is needed', () => {
    expect(buildArrowBurst({ col: 2, row: 2 }, { col: 2, row: 2 }, false)).toBe('')
  })
})

describe('altClickArrows gate', () => {
  it('fires only for plain Alt+Click', () => {
    expect(altClickArrows({ altKey: true, shiftKey: true })).toBe(false)
    expect(altClickArrows({ altKey: true, shiftKey: false })).toBe(true)
    expect(altClickArrows({ altKey: false, shiftKey: false })).toBe(false)
  })

  it('stays silent while the app enabled mouse reporting', () => {
    expect(altClickArrows({ altKey: true, shiftKey: false }, 'x10')).toBe(false)
    expect(altClickArrows({ altKey: true, shiftKey: false }, undefined)).toBe(true)
  })
})

describe('cellFromPointer', () => {
  const rect = { left: 10, top: 20, width: 800, height: 400 }
  it('maps pointer coordinates onto clamped cell indices', () => {
    // 80 cols × 24 rows over that rect → 10 px per column, 16.67 px per row.
    expect(cellFromPointer(95, 60, rect as DOMRect, 80, 24)).toEqual({ col: 8, row: 2 })
  })

  it('clamps overshoot into the last cell instead of out-of-range indices', () => {
    expect(cellFromPointer(9999, 9999, rect as DOMRect, 80, 24)).toEqual({ col: 79, row: 23 })
  })
})
