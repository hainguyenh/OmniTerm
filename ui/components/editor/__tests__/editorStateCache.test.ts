import { beforeEach, describe, expect, it, vi } from 'vitest'

type Cache = typeof import('../editorStateCache')
let cache: Cache

beforeEach(async () => {
  vi.resetModules()
  cache = await import('../editorStateCache')
})

describe('editorStateCache', () => {
  it('evicts the least recently shown clean hidden documents beyond the count budget', () => {
    const evicted: string[] = []
    const ids = Array.from({ length: cache.STATE_BUDGET.maxStates + 2 }, (_, index) => `t${index}`)
    for (const id of ids) {
      cache.registerDocument(id, () => evicted.push(id))
      cache.updateDocument(id, { visible: true })
      cache.updateDocument(id, { loaded: true, chars: 10 })
      cache.updateDocument(id, { visible: false })
    }
    expect(evicted).toEqual(['t0', 't1'])
  })

  it('never evicts dirty or visible documents', () => {
    const evicted: string[] = []
    cache.registerDocument('dirty', () => evicted.push('dirty'))
    cache.updateDocument('dirty', { loaded: true, chars: cache.STATE_BUDGET.maxChars, dirty: true })
    cache.registerDocument('shown', () => evicted.push('shown'))
    cache.updateDocument('shown', { visible: true, loaded: true, chars: 10 })
    expect(evicted).toEqual([])
    cache.registerDocument('clean', () => evicted.push('clean'))
    cache.updateDocument('clean', { loaded: true, chars: 10 })
    expect(evicted).toEqual(['clean'])
  })

  it('ignores updates for unknown or unregistered documents', () => {
    const evict = vi.fn()
    cache.updateDocument('nobody', { loaded: true })
    cache.registerDocument('gone', evict)
    cache.unregisterDocument('gone')
    cache.updateDocument('gone', { loaded: true, chars: cache.STATE_BUDGET.maxChars * 2 })
    expect(evict).not.toHaveBeenCalled()
  })
})
