/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry } from '@omniterm/contract'
import { mockOmnitermAPI } from '../../testUtils'
import { useWorkspaceScan } from '../useWorkspaceScan'

const dir = (id: string): WorkspaceEntry => ({
  id,
  name: id.split('/').pop() || id,
  path: `C:/ws/${id}`,
  isDir: true,
  kind: 'dir',
})

const file = (id: string): WorkspaceEntry => ({
  id,
  name: id.split('/').pop() || id,
  path: `C:/ws/${id}`,
  isDir: false,
  kind: 'txt',
  viewable: true,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('useWorkspaceScan', () => {
  beforeEach(() => {
    mockOmnitermAPI()
  })

  it('scans the directory skeleton and root page, then exposes a fresh flattened view', async () => {
    const scanFolders = vi.fn().mockResolvedValue([dir('docs')])
    const scanFolderEntries = vi.fn().mockResolvedValue({
      entries: [file('README.txt')], total: 1, hasMore: false,
    })
    mockOmnitermAPI({ workspace: { scanFolders, scanFolderEntries } })
    const { result } = renderHook(() => useWorkspaceScan())

    let request!: Promise<void>
    act(() => { request = result.current.scan('ws') })
    expect(result.current.scanning).toBe('ws')
    await act(async () => request)

    expect(scanFolders).toHaveBeenCalledWith('ws')
    expect(scanFolderEntries).toHaveBeenCalledWith('ws', '', 0, 2000)
    expect(result.current.folders.ws).toEqual([dir('docs')])
    expect(result.current.files.ws['']).toEqual([file('README.txt')])
    expect(result.current.pageInfo.ws['']).toEqual({ total: 1, hasMore: false })
    expect(result.current.entriesOf('ws').map((entry: WorkspaceEntry) => entry.id)).toEqual(['docs', 'README.txt'])
    expect(result.current.entriesOf('missing')).toEqual([])
    expect(result.current.scanning).toBeNull()
  })

  it('clears the scan spinner when either backend request fails', async () => {
    const scanFolders = vi.fn().mockRejectedValue(new Error('scan failed'))
    mockOmnitermAPI({
      workspace: {
        scanFolders,
        scanFolderEntries: vi.fn().mockResolvedValue({ entries: [], total: 0, hasMore: false }),
      },
    })
    const { result } = renderHook(() => useWorkspaceScan())

    await expect(act(async () => result.current.scan('ws'))).rejects.toThrow('scan failed')
    expect(result.current.scanning).toBeNull()
  })

  it('loads a folder once, exposes its spinner, and suppresses duplicate in-flight and loaded requests', async () => {
    const pending = deferred<{ entries: WorkspaceEntry[]; total: number; hasMore: boolean }>()
    const scanFolderEntries = vi.fn().mockReturnValue(pending.promise)
    mockOmnitermAPI({ workspace: { scanFolderEntries } })
    const { result } = renderHook(() => useWorkspaceScan())

    let first!: Promise<unknown>
    act(() => {
      first = result.current.loadFolder('ws', 'docs')
      void result.current.loadFolder('ws', 'docs')
    })
    expect(scanFolderEntries).toHaveBeenCalledTimes(1)
    expect(result.current.loadingFolders.has('ws:docs')).toBe(true)

    await act(async () => {
      pending.resolve({ entries: [file('docs/a.txt')], total: 1, hasMore: false })
      await first
    })
    expect(result.current.loadingFolders.has('ws:docs')).toBe(false)
    expect(result.current.files.ws.docs).toEqual([file('docs/a.txt')])

    await act(async () => result.current.loadFolder('ws', 'docs'))
    expect(scanFolderEntries).toHaveBeenCalledTimes(1)
  })

  it('clears a folder spinner when loading its first page fails', async () => {
    const scanFolderEntries = vi.fn().mockRejectedValue(new Error('folder failed'))
    mockOmnitermAPI({ workspace: { scanFolderEntries } })
    const { result } = renderHook(() => useWorkspaceScan())

    await expect(act(async () => result.current.loadFolder('ws', 'docs'))).rejects.toThrow('folder failed')
    expect(result.current.loadingFolders.size).toBe(0)
  })

  it('appends the next page from the current offset and clears the load-more state', async () => {
    const scanFolderEntries = vi.fn()
      .mockResolvedValueOnce({ entries: [file('docs/a.txt')], total: 2, hasMore: true })
      .mockResolvedValueOnce({ entries: [file('docs/b.txt')], total: 2, hasMore: false })
    mockOmnitermAPI({ workspace: { scanFolderEntries } })
    const { result } = renderHook(() => useWorkspaceScan())

    await act(async () => result.current.loadFolder('ws', 'docs'))
    let more!: Promise<unknown>
    act(() => { more = result.current.loadMore('ws', 'docs') })
    expect(result.current.loadingMore).toEqual({ wsId: 'ws', folder: 'docs' })
    await act(async () => more)

    expect(scanFolderEntries).toHaveBeenLastCalledWith('ws', 'docs', 1, 2000)
    expect(result.current.files.ws.docs.map((entry: WorkspaceEntry) => entry.id)).toEqual(['docs/a.txt', 'docs/b.txt'])
    expect(result.current.pageInfo.ws.docs).toEqual({ total: 2, hasMore: false })
    expect(result.current.loadingMore).toBeNull()
  })

  it('suppresses a load-more request while the same folder is already fetching', async () => {
    const pending = deferred<{ entries: WorkspaceEntry[]; total: number; hasMore: boolean }>()
    const scanFolderEntries = vi.fn().mockReturnValue(pending.promise)
    mockOmnitermAPI({ workspace: { scanFolderEntries } })
    const { result } = renderHook(() => useWorkspaceScan())

    let request!: Promise<unknown>
    act(() => {
      request = result.current.loadMore('ws', 'docs')
      void result.current.loadMore('ws', 'docs')
    })
    expect(scanFolderEntries).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve({ entries: [], total: 0, hasMore: false })
      await request
    })
  })

  it('clears load-more state after a rejected page', async () => {
    mockOmnitermAPI({
      workspace: { scanFolderEntries: vi.fn().mockRejectedValue(new Error('page failed')) },
    })
    const { result } = renderHook(() => useWorkspaceScan())

    await expect(act(async () => result.current.loadMore('ws', 'docs'))).rejects.toThrow('page failed')
    expect(result.current.loadingMore).toBeNull()
  })

  it('loads every folder in batches and drains every remaining page', async () => {
    const calls: string[] = []
    const scanFolderEntries = vi.fn(async (_id: string, folder: string, offset: number) => {
      calls.push(`${folder || '<root>'}:${offset}`)
      if (folder === '' && offset === 0) return { entries: [file('root-a.txt')], total: 2, hasMore: true }
      if (folder === '' && offset === 1) return { entries: [file('root-b.txt')], total: 2, hasMore: false }
      if (folder === 'a' && offset === 0) return { entries: [file('a/one.txt')], total: 2, hasMore: true }
      if (folder === 'a' && offset === 1) return { entries: [file('a/two.txt')], total: 2, hasMore: false }
      return { entries: [file(`${folder}/only.txt`)], total: 1, hasMore: false }
    })
    mockOmnitermAPI({
      workspace: {
        scanFolders: vi.fn().mockResolvedValue([dir('a'), dir('b')]),
        scanFolderEntries,
      },
    })
    const { result } = renderHook(() => useWorkspaceScan())
    await act(async () => result.current.scan('ws'))

    let all!: Promise<void>
    act(() => { all = result.current.loadAll('ws') })
    expect(result.current.loadingAll).toBe('ws')
    await act(async () => all)

    expect(calls).toEqual(expect.arrayContaining(['<root>:0', 'a:0', 'b:0', '<root>:1', 'a:1']))
    expect(result.current.files.ws[''].map((entry: WorkspaceEntry) => entry.id)).toEqual(['root-a.txt', 'root-b.txt'])
    expect(result.current.files.ws.a.map((entry: WorkspaceEntry) => entry.id)).toEqual(['a/one.txt', 'a/two.txt'])
    expect(result.current.files.ws.b.map((entry: WorkspaceEntry) => entry.id)).toEqual(['b/only.txt'])
    expect(result.current.loadingAll).toBeNull()
  })

  it('suppresses duplicate load-all calls and clears state after failure', async () => {
    const pending = deferred<{ entries: WorkspaceEntry[]; total: number; hasMore: boolean }>()
    const scanFolderEntries = vi.fn().mockReturnValue(pending.promise)
    mockOmnitermAPI({ workspace: { scanFolderEntries } })
    const { result } = renderHook(() => useWorkspaceScan())

    let first!: Promise<void>
    act(() => {
      first = result.current.loadAll('ws')
      void result.current.loadAll('ws')
    })
    expect(scanFolderEntries).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.reject(new Error('all failed'))
      await expect(first).rejects.toThrow('all failed')
    })
    await waitFor(() => expect(result.current.loadingAll).toBeNull())
  })
})
