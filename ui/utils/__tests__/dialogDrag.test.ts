import { describe, expect, it } from 'vitest'
import { dragOffset } from '../dialogDrag'

describe('dragOffset', () => {
  const box = { left: 100, top: 100, width: 400 }
  const viewport = { width: 1000, height: 800 }
  const startOffset = { x: 0, y: 0 }

  it('translates by delta when within viewport bounds', () => {
    const from = { x: 200, y: 200 }
    const to = { x: 250, y: 280 }
    const offset = dragOffset(startOffset, from, to, box, viewport)
    expect(offset).toEqual({ x: 50, y: 80 })
  })

  it('clamps top to not leave the window top', () => {
    const from = { x: 200, y: 200 }
    const to = { x: 200, y: 50 } // delta -150, would put top at -50
    const offset = dragOffset(startOffset, from, to, box, viewport)
    expect(offset.y).toBe(-100) // 100 - 100 = 0 (top clamped to 0)
  })

  it('clamps left and right to keep at least MIN_VISIBLE reachable', () => {
    const from = { x: 200, y: 200 }
    const to = { x: 1200, y: 200 } // dragged way to the right
    const offset = dragOffset(startOffset, from, to, box, viewport)
    // viewport.width - 48 = 952. 952 - 100 = 852.
    expect(offset.x).toBe(852)
  })
})
