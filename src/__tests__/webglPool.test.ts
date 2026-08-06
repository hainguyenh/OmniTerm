import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acquire, heldCount, MAX_CONTEXTS, release, resetForTests, touch } from '../utils/webglPool'

describe('webglPool', () => {
  beforeEach(() => resetForTests())

  it('holds every registered slot while under the cap', () => {
    const evictions: number[] = []
    for (let i = 0; i < MAX_CONTEXTS; i++) acquire({}, () => evictions.push(i))
    expect(heldCount()).toBe(MAX_CONTEXTS)
    expect(evictions).toEqual([])
  })

  // The whole point: a pane keeps its renderer across tab switches, and only a genuine shortage costs
  // anyone one — the pane the user has touched least.
  it('evicts the least recently touched slot once the cap is exceeded', () => {
    const evicted: string[] = []
    const keys = Array.from({ length: MAX_CONTEXTS }, (_, i) => ({ i }))
    keys.forEach((key, i) => acquire(key, () => evicted.push(`slot-${i}`)))

    // Slot 0 is the coldest by acquisition order — until it is focused again.
    touch(keys[0])
    acquire({}, () => evicted.push('newcomer'))

    expect(evicted).toEqual(['slot-1'])
    expect(heldCount()).toBe(MAX_CONTEXTS)
  })

  it('re-acquiring a held slot moves it to the front instead of adding a second entry', () => {
    const key = {}
    const evict = vi.fn()
    acquire(key, evict)
    acquire(key, evict)
    expect(heldCount()).toBe(1)
    expect(evict).not.toHaveBeenCalled()
  })

  it('frees the slot on release and ignores a release or touch it does not know', () => {
    const key = {}
    acquire(key, vi.fn())
    release(key)
    expect(heldCount()).toBe(0)
    // Idempotent: unmount, context loss, and eviction can all land on the same slot.
    expect(() => { release(key); touch(key) }).not.toThrow()
    expect(heldCount()).toBe(0)
  })
})
