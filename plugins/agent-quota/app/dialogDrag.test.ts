import { describe, expect, it } from 'vitest'

import { dragOffset } from './dialogDrag'

const VIEWPORT = { width: 1000, height: 800 }
const BOX = { left: 200, top: 100, width: 600 }
const ORIGIN = { x: 0, y: 0 }

describe('dragOffset', () => {
  it('follows the pointer from where the drag began', () => {
    expect(dragOffset(ORIGIN, { x: 300, y: 120 }, { x: 350, y: 180 }, BOX, VIEWPORT)).toEqual({ x: 50, y: 60 })
    // A second drag starts from the offset the first one left.
    expect(dragOffset({ x: 50, y: 60 }, { x: 10, y: 10 }, { x: 0, y: 30 }, { ...BOX, left: 250, top: 160 }, VIEWPORT)).toEqual({ x: 40, y: 80 })
  })

  it('keeps the header on screen and some of the dialog reachable', () => {
    // Up past the top edge: the header stops at the top of the window.
    expect(dragOffset(ORIGIN, { x: 0, y: 0 }, { x: 0, y: -500 }, BOX, VIEWPORT).y).toBe(-100)
    // Down past the bottom: 48px stay visible.
    expect(dragOffset(ORIGIN, { x: 0, y: 0 }, { x: 0, y: 2000 }, BOX, VIEWPORT).y).toBe(800 - 48 - 100)
    // Sideways, 48px stay reachable on either side.
    expect(dragOffset(ORIGIN, { x: 0, y: 0 }, { x: -5000, y: 0 }, BOX, VIEWPORT).x).toBe(48 - 600 - 200)
    expect(dragOffset(ORIGIN, { x: 0, y: 0 }, { x: 5000, y: 0 }, BOX, VIEWPORT).x).toBe(1000 - 48 - 200)
  })
})
