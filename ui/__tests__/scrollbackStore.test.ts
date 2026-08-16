import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteScrollback,
  loadScrollback,
  pruneScrollback,
  saveScrollback,
  MAX_SCROLLBACK_BYTES,
} from '../utils/scrollbackStore'

describe('scrollbackStore', () => {
  beforeEach(async () => {
    await pruneScrollback(new Set())
  })

  afterEach(async () => {
    await pruneScrollback(new Set())
  })

  it('saves and loads scrollback data by key', async () => {
    await saveScrollback('tab-1', 'Hello Claude\x1b[32mAgent\x1b[0m')
    const loaded = await loadScrollback('tab-1')
    expect(loaded).toBe('Hello Claude\x1b[32mAgent\x1b[0m')
  })

  it('returns null for non-existent key', async () => {
    const loaded = await loadScrollback('non-existent')
    expect(loaded).toBeNull()
  })

  it('truncates scrollback larger than MAX_SCROLLBACK_BYTES, keeping the tail', async () => {
    const data = 'A'.repeat(1000) + 'B'.repeat(MAX_SCROLLBACK_BYTES)
    await saveScrollback('tab-large', data)
    const loaded = await loadScrollback('tab-large')
    // The most recent output survives; the oldest prefix is dropped.
    expect(loaded?.length).toBe(MAX_SCROLLBACK_BYTES)
    expect(loaded?.startsWith('A')).toBe(false)
    expect(loaded?.endsWith('BBB')).toBe(true)
  })

  it('deletes scrollback by key', async () => {
    await saveScrollback('tab-del', 'data')
    await deleteScrollback('tab-del')
    expect(await loadScrollback('tab-del')).toBeNull()
  })

  it('prunes scrollbacks not present in active keys', async () => {
    await saveScrollback('tab-keep', 'keep-me')
    await saveScrollback('tab-drop', 'drop-me')
    await pruneScrollback(new Set(['tab-keep']))
    expect(await loadScrollback('tab-keep')).toBe('keep-me')
    expect(await loadScrollback('tab-drop')).toBeNull()
  })
})
