import { useCallback, useRef, useState } from 'react'
import type { WorkspaceEntry } from '@omniterm/contract'

/** Loaded-file totals for one folder of a workspace, driving its "Show more" row. */
export interface FolderPageInfo {
  /** Every file the folder holds — what the remaining count counts down from. */
  total: number
  hasMore: boolean
}

/** Default files per folder page, mirroring the backend's `DEFAULT_PAGE_SIZE`. */
const PAGE_SIZE = 2000

/**
 * The Workspace panel's tree data: one folder skeleton per workspace, with each folder's files
 * fetched lazily and grown one page at a time.
 *
 * The skeleton (all directories) plus the root's first page arrive together on expand — the panel
 * shows every folder up front, which is what makes "Show more" a per-folder row rather than a
 * whole-workspace one. A folder's files load on first expand (`loadFolder`) and grow with its own
 * "Show more" row (`loadMore`). `loadAll` drains every folder completely, for the views that
 * promise the whole workspace (scripts, selected files, the flat list) and must not page.
 */
export function useWorkspaceScan() {
  const [folders, setFolders] = useState<Record<string, WorkspaceEntry[]>>({})
  const [files, setFiles] = useState<Record<string, Record<string, WorkspaceEntry[]>>>({})
  const [pageInfo, setPageInfo] = useState<Record<string, Record<string, FolderPageInfo>>>({})
  const [scanning, setScanning] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState<{ wsId: string; folder: string } | null>(null)
  const [loadingAll, setLoadingAll] = useState<string | null>(null)
  // Per-folder "first page in flight" state, for the row's own spinner — a state mirror of
  // `inFlight` below, which is a ref and so cannot drive a render.
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set())

  // Fresh state behind a stable read: `entriesOf` must keep its identity so consumers (the reveal
  // hook's effect, memoized tree builders) can call it after an await and see the latest files.
  const stateRef = useRef({ folders, files, pageInfo })
  stateRef.current = { folders, files, pageInfo }
  // One fetch per (workspace, folder) at a time — a double expand or a load-more racing `loadAll`
  // must not fetch the same offset twice and duplicate entries.
  const inFlight = useRef(new Set<string>())

  /** Skeleton + the root folder's first page — also the rescan. Replaces whatever was loaded. */
  const scan = useCallback(async (id: string) => {
    setScanning(id)
    try {
      const [dirs, root] = await Promise.all([
        window.omnitermAPI.workspace.scanFolders(id),
        window.omnitermAPI.workspace.scanFolderEntries(id, '', 0, PAGE_SIZE),
      ])
      setFolders((prev) => ({ ...prev, [id]: dirs }))
      setFiles((prev) => ({ ...prev, [id]: { '': root.entries } }))
      setPageInfo((prev) => ({ ...prev, [id]: { '': { total: root.total, hasMore: root.hasMore } } }))
    } finally {
      setScanning(null)
    }
  }, [])

  /** First page of a folder's files, asked for when the folder is expanded. */
  const loadFolder = useCallback(async (id: string, folder: string) => {
    const key = `${id}:${folder}`
    if (inFlight.current.has(key) || stateRef.current.files[id]?.[folder] !== undefined) return null
    inFlight.current.add(key)
    setLoadingFolders((prev) => new Set(prev).add(key))
    try {
      const page = await window.omnitermAPI.workspace.scanFolderEntries(id, folder, 0, PAGE_SIZE)
      setFiles((prev) => ({
        ...prev,
        [id]: { ...(prev[id] ?? {}), [folder]: page.entries },
      }))
      setPageInfo((prev) => ({
        ...prev,
        [id]: { ...(prev[id] ?? {}), [folder]: { total: page.total, hasMore: page.hasMore } },
      }))
      return page
    } finally {
      inFlight.current.delete(key)
      setLoadingFolders((prev) => {
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [])

  /**
   * Append the next page of one folder — asked for by that folder's "Show more" row.
   *
   * `knownLoaded` lets a caller that is draining several pages back-to-back (see `loadAll` below)
   * pass the count it already knows it fetched, rather than reading `stateRef` — which only
   * refreshes on a render, so a burst of pages resolving faster than React commits would otherwise
   * see the same stale count and refetch the same page forever.
   */
  const loadMore = useCallback(async (id: string, folder: string, knownLoaded?: number) => {
    const key = `${id}:${folder}`
    if (inFlight.current.has(key)) return null
    inFlight.current.add(key)
    setLoadingMore({ wsId: id, folder })
    try {
      const loaded = knownLoaded ?? stateRef.current.files[id]?.[folder]?.length ?? 0
      const page = await window.omnitermAPI.workspace.scanFolderEntries(id, folder, loaded, PAGE_SIZE)
      setFiles((prev) => ({
        ...prev,
        [id]: { ...(prev[id] ?? {}), [folder]: [...(prev[id]?.[folder] ?? []), ...page.entries] },
      }))
      setPageInfo((prev) => ({
        ...prev,
        [id]: { ...(prev[id] ?? {}), [folder]: { total: page.total, hasMore: page.hasMore } },
      }))
      return page
    } finally {
      inFlight.current.delete(key)
      setLoadingMore(null)
    }
  }, [])

  /** Load every folder's files completely — for views that must not page. */
  const loadAll = useCallback(async (id: string) => {
    const key = `all:${id}`
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    setLoadingAll(id)
    try {
      const paths = ['', ...(stateRef.current.folders[id] ?? []).map((d) => d.id)]
      // Every folder needs its first page — `loadFolder` skips what is already loaded. Track each
      // folder's hasMore/loaded-count from what it actually returned rather than re-reading
      // `stateRef` afterward: several pages resolving back-to-back can outrun the render that would
      // refresh it, which would otherwise make this loop refetch the same page forever.
      const hasMore = new Map<string, boolean>()
      const loadedCount = new Map<string, number>()
      for (let i = 0; i < paths.length; i += 8) {
        const pages = await Promise.all(paths.slice(i, i + 8).map((p) => loadFolder(id, p)))
        paths.slice(i, i + 8).forEach((p, j) => {
          const page = pages[j]
          if (page) {
            hasMore.set(p, page.hasMore)
            loadedCount.set(p, page.entries.length)
          } else {
            // Already loaded by a previous call — current state is reliable here since nothing
            // else is racing to fetch this folder's first page in this operation.
            hasMore.set(p, stateRef.current.pageInfo[id]?.[p]?.hasMore ?? false)
            loadedCount.set(p, stateRef.current.files[id]?.[p]?.length ?? 0)
          }
        })
      }
      for (;;) {
        const pending = paths.filter((p) => hasMore.get(p))
        if (pending.length === 0) break
        for (let i = 0; i < pending.length; i += 8) {
          await Promise.all(pending.slice(i, i + 8).map(async (p) => {
            const page = await loadMore(id, p, loadedCount.get(p) ?? 0)
            if (!page) { hasMore.set(p, false); return }
            hasMore.set(p, page.hasMore)
            loadedCount.set(p, (loadedCount.get(p) ?? 0) + page.entries.length)
          }))
        }
      }
    } finally {
      inFlight.current.delete(key)
      setLoadingAll(null)
    }
  }, [])

  /** Everything loaded for one workspace, flattened back to the scan's flat entry shape. */
  const entriesOf = useCallback(
    (id: string): WorkspaceEntry[] => [
      ...(stateRef.current.folders[id] ?? []),
      ...Object.values(stateRef.current.files[id] ?? {}).flat(),
    ],
    [],
  )

  return {
    folders, files, pageInfo, scanning, loadingMore, loadingAll, loadingFolders,
    scan, loadFolder, loadMore, loadAll, entriesOf,
  }
}
