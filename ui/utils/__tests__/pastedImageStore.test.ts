/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLastPastedImage,
  releasePastedImage,
  requestOpen,
  setLastPastedImage,
  subscribeOpen,
  subscribePastedImage,
} from '../pastedImageStore'

const stubObjectUrls = () => {
  let next = 0
  const created: string[] = []
  const revoked: string[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:mock-${next++}`
    created.push(url)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url)
  })
  return { created, revoked }
}

describe('pastedImageStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    releasePastedImage('sess-1')
    releasePastedImage('sess-2')
  })

  it('stores the last pasted image for a session', () => {
    const urls = stubObjectUrls()
    setLastPastedImage('sess-1', { bytes: new Uint8Array([1, 2]), path: 'C:/temp/a.png' })

    const image = getLastPastedImage('sess-1')
    expect(image?.objectUrl).toBe(urls.created[0])
    expect(image?.path).toBe('C:/temp/a.png')
  })

  it('notifies slot subscribers on set and release', () => {
    stubObjectUrls()
    const listener = vi.fn()
    const unsubscribe = subscribePastedImage('sess-1', listener)

    setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' })
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    releasePastedImage('sess-1')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('replaces the slot and revokes the previous URL only', () => {
    const urls = stubObjectUrls()
    setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' })
    setLastPastedImage('sess-1', { bytes: new Uint8Array([2]), path: 'C:/temp/b.png' })

    expect(urls.revoked).toEqual([urls.created[0]])
    expect(getLastPastedImage('sess-1')?.path).toBe('C:/temp/b.png')
    expect(getLastPastedImage('sess-1')?.objectUrl).toBe(urls.created[1])
  })

  it('keeps sessions isolated', () => {
    const urls = stubObjectUrls()
    setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' })
    setLastPastedImage('sess-2', { bytes: new Uint8Array([2]), path: 'C:/temp/b.png' })

    expect(getLastPastedImage('sess-1')?.path).toBe('C:/temp/a.png')
    expect(getLastPastedImage('sess-2')?.objectUrl).toBe(urls.created[1])
  })

  it('treats a null session or an empty payload as a no-op', () => {
    const urls = stubObjectUrls()
    setLastPastedImage(null, { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' })
    setLastPastedImage('sess-1', { bytes: new Uint8Array(0), path: 'C:/temp/a.png' })

    expect(getLastPastedImage(null)).toBeNull()
    expect(getLastPastedImage('sess-1')).toBeNull()
    expect(urls.created).toHaveLength(0)
  })

  it('release revokes the URL and clears the slot', () => {
    const urls = stubObjectUrls()
    setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' })
    releasePastedImage('sess-1')

    expect(urls.revoked).toContain(urls.created[0])
    expect(getLastPastedImage('sess-1')).toBeNull()
  })

  it('requestOpen notifies open subscribers until unsubscribed', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeOpen('sess-1', listener)

    requestOpen('sess-1')
    requestOpen(null) // must not throw or notify anyone
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    requestOpen('sess-1')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('survives an environment without object URLs', () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('unsupported')
    })
    expect(() =>
      setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' }),
    ).not.toThrow()
    expect(getLastPastedImage('sess-1')).toBeNull()
  })
})
