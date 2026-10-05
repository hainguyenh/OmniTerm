import { describe, expect, it } from 'vitest'

import { changeIndexAt, nextChangeIndex } from '../diffEditorModel'

const CHANGES = [
  { from: 10, to: 20 },
  { from: 40, to: 40 },
  { from: 70, to: 90 },
]

describe('nextChangeIndex', () => {
  it('moves forward to the first change starting after the cursor', () => {
    expect(nextChangeIndex(CHANGES, 0, 1)).toBe(0)
    expect(nextChangeIndex(CHANGES, 10, 1)).toBe(1)
    expect(nextChangeIndex(CHANGES, 50, 1)).toBe(2)
  })

  it('wraps forward from the last change to the first', () => {
    expect(nextChangeIndex(CHANGES, 70, 1)).toBe(0)
    expect(nextChangeIndex(CHANGES, 200, 1)).toBe(0)
  })

  it('moves back to the last change starting before the cursor, wrapping at the start', () => {
    expect(nextChangeIndex(CHANGES, 70, -1)).toBe(1)
    expect(nextChangeIndex(CHANGES, 41, -1)).toBe(1)
    expect(nextChangeIndex(CHANGES, 10, -1)).toBe(2)
    expect(nextChangeIndex(CHANGES, 0, -1)).toBe(2)
  })
})

describe('changeIndexAt', () => {
  it('finds the change holding the cursor, including a pure deletion', () => {
    expect(changeIndexAt(CHANGES, 15)).toBe(0)
    expect(changeIndexAt(CHANGES, 40)).toBe(1)
    expect(changeIndexAt(CHANGES, 90)).toBe(2)
  })

  it('is -1 between changes', () => {
    expect(changeIndexAt(CHANGES, 30)).toBe(-1)
    expect(changeIndexAt([], 0)).toBe(-1)
  })
})
