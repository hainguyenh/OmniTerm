import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceEntry } from '@omniterm/contract'
import { applyFilter, type TreeFilter } from '../utils/workspaceFilter'

/** A one-shot request to expand, scroll to, and flash a file in the Workspace tree. */
export interface RevealRequest {
  workspaceId: string
  /** Folder-namespaced logical path (a `WorkspaceScript.id`), matching `WorkspaceTreeNode.path`. */
  path: string
  /** Bumped on every request so revealing the same file twice in a row still fires. */
  nonce: number
}

/**
 * Drives WorkspacePanel's "Reveal in tree" target — the file behind the active editor tab's Locate
 * icon (see SessionTabs). Extracted out of WorkspacePanel to keep it under its line-limit baseline;
 * the panel owns the state this needs (scan, per-folder loads, filters, expansion set) and just
 * wires it through.
 */
export function useTreeReveal(params: {
  revealRequest?: RevealRequest | null
  /** Flattened entries for one workspace; a stable callback reading the latest scan state. */
  entriesOf: (workspaceId: string) => WorkspaceEntry[]
  /** First-load of a workspace (a no-op once its skeleton is in). */
  scan: (id: string) => Promise<void>
  /** First page of one folder's files. */
  loadFolder: (workspaceId: string, folder: string) => Promise<unknown>
  filterOf: (workspaceId: string) => TreeFilter
  setExpandedId: (id: string | null) => void
  setFlatView: (v: boolean) => void
  setExpandedDirs: React.Dispatch<React.SetStateAction<Set<string>>>
  setFilters: React.Dispatch<React.SetStateAction<Record<string, TreeFilter>>>
}) {
  const {
    revealRequest, entriesOf, scan, loadFolder, filterOf,
    setExpandedId, setFlatView, setExpandedDirs, setFilters,
  } = params
  const [highlight, setHighlight] = useState<{ workspaceId: string; path: string } | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())

  // Triggered by `revealRequest.nonce` only — the callback reads fresh `entriesOf`/`filters` off the
  // closure, so it must not also re-run whenever those change mid-reveal (that would fight its own
  // `setFilters`/`setExpandedDirs` below).
  useEffect(() => {
    if (!revealRequest) return
    const { workspaceId, path } = revealRequest
    let cancelled = false
    void (async () => {
      setExpandedId(workspaceId)
      await scan(workspaceId)
      if (cancelled) return
      setFlatView(false)
      const segments = path.split('/')
      const ancestors: string[] = []
      let acc = ''
      for (let i = 0; i < segments.length - 1; i++) {
        acc = acc ? `${acc}/${segments[i]}` : segments[i]
        ancestors.push(acc)
      }
      // Folders start collapsed and load on expand, so the reveal must both open and load each
      // ancestor of the target — otherwise the file's row cannot exist.
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        ancestors.forEach((a) => next.add(`${workspaceId}:${a}`))
        return next
      })
      for (const ancestor of ancestors) {
        await loadFolder(workspaceId, ancestor)
        if (cancelled) return
      }
      const target = entriesOf(workspaceId).find((e) => e.id === path)
      const currentFilter = filterOf(workspaceId)
      // Widen the filter if it would otherwise hide the file — the point is to actually find it.
      if (target && applyFilter([target], currentFilter).length === 0) {
        setFilters((prev) => ({ ...prev, [workspaceId]: { ...currentFilter, mode: 'all' } }))
      }
      setHighlight({ workspaceId, path })
    })()
    return () => { cancelled = true }
  }, [revealRequest?.nonce])

  useEffect(() => {
    if (!highlight) return
    rowRefs.current.get(`${highlight.workspaceId}:${highlight.path}`)?.scrollIntoView({ block: 'center' })
    const timer = setTimeout(() => setHighlight(null), 1600)
    return () => clearTimeout(timer)
  }, [highlight])

  const isHighlighted = useCallback(
    (workspaceId: string, path: string) => highlight?.workspaceId === workspaceId && highlight.path === path,
    [highlight],
  )

  /** Ref callback for a file row, keyed so the scroll effect above can find its DOM node. */
  const registerRow = useCallback((workspaceId: string, path: string) => (el: HTMLDivElement | null) => {
    const key = `${workspaceId}:${path}`
    if (el) rowRefs.current.set(key, el)
    else rowRefs.current.delete(key)
  }, [])

  return { isHighlighted, registerRow }
}
