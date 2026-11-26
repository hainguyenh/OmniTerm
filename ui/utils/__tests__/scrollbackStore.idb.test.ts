/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (() => void) | null

/** The slice of IndexedDB scrollbackStore uses, completing each request on a later tick. */
class FakeDb {
  data = new Map<string, string>()
  failTx = false
  stores = new Set<string>()
  objectStoreNames = { contains: (name: string) => this.stores.has(name) }
  createObjectStore(name: string) { this.stores.add(name) }
  transaction() {
    if (this.failTx) throw new Error('tx failed')
    const tx: { oncomplete: Handler; onerror: Handler; objectStore: () => unknown } = {
      oncomplete: null,
      onerror: null,
      objectStore: () => ({
        put: (value: string, key: string) => { this.data.set(key, value); setTimeout(() => tx.oncomplete?.()) },
        delete: (key: string) => { this.data.delete(key); setTimeout(() => tx.oncomplete?.()) },
        get: (key: string) => {
          const req: { result?: unknown; onsuccess: Handler; onerror: Handler } = { onsuccess: null, onerror: null }
          setTimeout(() => { req.result = this.data.get(key); req.onsuccess?.() })
          return req
        },
        getAllKeys: () => {
          const req: { result?: unknown; onsuccess: Handler; onerror: Handler } = { onsuccess: null, onerror: null }
          setTimeout(() => { req.result = [...this.data.keys()]; req.onsuccess?.() })
          return req
        },
      }),
    }
    return tx
  }
}

let db: FakeDb
let openMode: 'ok' | 'error' | 'throw'

function installIndexedDb() {
  vi.stubGlobal('indexedDB', {
    open: () => {
      if (openMode === 'throw') throw new Error('private mode')
      const req: { result: FakeDb; onupgradeneeded: Handler; onsuccess: Handler; onerror: Handler } = {
        result: db, onupgradeneeded: null, onsuccess: null, onerror: null,
      }
      setTimeout(() => {
        if (openMode === 'error') { req.onerror?.(); return }
        req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
  })
}

async function load() {
  vi.resetModules()
  return import('../scrollbackStore')
}

describe('scrollbackStore with IndexedDB', () => {
  beforeEach(() => {
    db = new FakeDb()
    openMode = 'ok'
    installIndexedDb()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('creates the object store and persists a buffer', async () => {
    const store = await load()
    await store.saveScrollback('tab', 'hello')
    expect(db.stores.has('scrollbacks')).toBe(true)
    expect(db.data.get('tab')).toBe('hello')
  })

  it('keeps only the tail of an oversized buffer and ignores empty input', async () => {
    const store = await load()
    await store.saveScrollback('', 'x')
    await store.saveScrollback('tab', '')
    expect(db.data.size).toBe(0)
    await store.saveScrollback('tab', 'a'.repeat(store.MAX_SCROLLBACK_BYTES) + 'tail')
    expect(db.data.get('tab')?.length).toBe(store.MAX_SCROLLBACK_BYTES)
    expect(db.data.get('tab')?.endsWith('tail')).toBe(true)
  })

  it('loads from the database after the memory copy is gone', async () => {
    db.data.set('tab', 'persisted')
    const store = await load()
    await expect(store.loadScrollback('')).resolves.toBeNull()
    await expect(store.loadScrollback('tab')).resolves.toBe('persisted')
    await expect(store.loadScrollback('missing')).resolves.toBeNull()
  })

  it('deletes from memory and the database', async () => {
    const store = await load()
    await store.saveScrollback('tab', 'x')
    await store.deleteScrollback('')
    await store.deleteScrollback('tab')
    expect(db.data.has('tab')).toBe(false)
    await expect(store.loadScrollback('tab')).resolves.toBeNull()
  })

  it('prunes keys that are no longer active', async () => {
    const store = await load()
    await store.saveScrollback('keep', '1')
    await store.saveScrollback('drop', '2')
    db.data.set('stale', '3')
    await store.pruneScrollback(new Set(['keep']))
    expect([...db.data.keys()]).toEqual(['keep'])
  })

  it('swallows transaction failures', async () => {
    const store = await load()
    await store.saveScrollback('tab', 'x')
    db.failTx = true
    await expect(store.saveScrollback('tab', 'y')).resolves.toBeUndefined()
    await expect(store.deleteScrollback('tab')).resolves.toBeUndefined()
    await expect(store.pruneScrollback(new Set())).resolves.toBeUndefined()
    const fresh = await load()
    await expect(fresh.loadScrollback('other')).resolves.toBeNull()
  })

  it('falls back to memory when the database cannot be opened, then retries', async () => {
    openMode = 'error'
    const store = await load()
    await store.saveScrollback('tab', 'mem')
    await expect(store.loadScrollback('tab')).resolves.toBe('mem')
    openMode = 'ok'
    await store.saveScrollback('tab2', 'later')
    expect(db.data.get('tab2')).toBe('later')
  })

  it('survives an indexedDB that throws on open', async () => {
    openMode = 'throw'
    const store = await load()
    await expect(store.saveScrollback('tab', 'x')).resolves.toBeUndefined()
    await expect(store.pruneScrollback(new Set())).resolves.toBeUndefined()
  })

  it('works without indexedDB at all', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const store = await load()
    await store.saveScrollback('tab', 'x')
    await expect(store.loadScrollback('tab')).resolves.toBe('x')
    await expect(store.loadScrollback('none')).resolves.toBeNull()
    await store.deleteScrollback('tab')
    await store.pruneScrollback(new Set())
  })
})
