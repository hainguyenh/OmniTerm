/**
 * scrollbackStore.ts — stores terminal scrollback buffers in IndexedDB for cross-restart display.
 */

export const MAX_SCROLLBACK_BYTES = 512 * 1024 // 512 KB per tab

const DB_NAME = 'omniterm_cache'
const STORE_NAME = 'scrollbacks'
const DB_VERSION = 1

// In-memory fallback for test environments or private browsing
const memoryStore = new Map<string, string>()

// Cached connection — opening IndexedDB per operation leaks connections; the browser caps them.
// A failed open is not cached so the next operation retries.
let dbPromise: Promise<IDBDatabase | null> | null = null

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') {
    dbPromise = Promise.resolve(null)
    return dbPromise
  }
  dbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        dbPromise = null
        resolve(null)
      }
    } catch {
      dbPromise = null
      resolve(null)
    }
  })
  return dbPromise
}

export async function saveScrollback(key: string, data: string): Promise<void> {
  if (!key || !data) return
  const truncated = data.length > MAX_SCROLLBACK_BYTES ? data.slice(-MAX_SCROLLBACK_BYTES) : data
  memoryStore.set(key, truncated)

  const db = await openDB()
  if (!db) return

  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put(truncated, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

export async function loadScrollback(key: string): Promise<string | null> {
  if (!key) return null
  if (memoryStore.has(key)) return memoryStore.get(key) ?? null

  const db = await openDB()
  if (!db) return null

  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(key)
      req.onsuccess = () => resolve((req.result as string) ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function deleteScrollback(key: string): Promise<void> {
  if (!key) return
  memoryStore.delete(key)

  const db = await openDB()
  if (!db) return

  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

export async function pruneScrollback(activeKeys: Set<string>): Promise<void> {
  for (const key of memoryStore.keys()) {
    if (!activeKeys.has(key)) memoryStore.delete(key)
  }

  const db = await openDB()
  if (!db) return

  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.getAllKeys()
      req.onsuccess = () => {
        const keys = req.result as string[]
        for (const key of keys) {
          if (!activeKeys.has(key)) store.delete(key)
        }
        resolve()
      }
      req.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}
