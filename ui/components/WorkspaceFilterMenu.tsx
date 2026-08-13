import React, { useEffect, useMemo, useRef, useState } from 'react'
import { GripHorizontal, X, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import type { WorkspaceEntry } from '@omniterm/contract'
import {
  DEFAULT_TREE_FILTER, discoverKinds, isDefaultFilter, isHiddenEntry, isScriptEntry, type TreeFilter,
} from '../utils/workspaceFilter'
import { fileKindMeta } from '../utils/fileKind'
import WorkspaceFilterTree from './WorkspaceFilterTree'
import { buildWorkspaceTree, collectFilterDirPaths } from '../utils/scriptTree'

/**
 * The Workspace tree's "what do I show" control.
 *
 * A workspace folder holds far more than runnable scripts, so the tree defaults to scripts only and
 * this popover opens it up: every file, the types you pick, or a set of files ticked out of the
 * workspace's own tree. The scan is cached in the panel (see useWorkspaceScan), so switching is a
 * re-render, never a rescan.
 *
 * Controlled and `position: fixed` rather than self-triggering and absolute: the sidebar is as narrow
 * as 180px and clips its overflow, so a popover anchored inside it was simply cut off — and the panel
 * needs two ways in (the funnel icon and the summary label) onto one menu. It is draggable by its
 * title bar too, because a filter you drive against the tree wants to sit beside the tree, not on it.
 */
interface WorkspaceFilterMenuProps {
  filter: TreeFilter
  onChange: (filter: TreeFilter) => void
  /** The whole scan for this workspace — the tree the user ticks files out of. */
  entries: WorkspaceEntry[]
  /** Where to pin the popover: the bounding rect of whichever trigger opened it. */
  anchor: DOMRect | null
  onClose: () => void
}

const MENU_WIDTH = 288
const VIEWPORT_GAP = 8

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const smallButton = 'rounded px-1.5 py-0.5 text-[10px] text-[var(--theme-dim)] hover:bg-[var(--theme-hover-bg)] hover:text-[var(--theme-fg)]'

const WorkspaceFilterMenu: React.FC<WorkspaceFilterMenuProps> = ({
  filter, onChange, entries, anchor, onClose,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null)
  // Where the user dragged the dialog to; `null` = still where its trigger put it.
  const [dragged, setDragged] = useState<{ left: number; top: number } | null>(null)
  const [typeSearch, setTypeSearch] = useState('')
  const [fileSearch, setFileSearch] = useState('')

  // Same dismiss contract as the app's other popovers: click anywhere outside, or press Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      // A trigger closes the menu through its own click handler; closing here too would make the
      // click reopen what the mousedown just dismissed.
      if (target?.closest('[data-filter-trigger]')) return
      if (wrapRef.current && !wrapRef.current.contains(target)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [onClose])

  // A new anchor means a new open, which should land under its trigger rather than wherever the
  // dialog happened to be dropped last time.
  useEffect(() => { setDragged(null) }, [anchor])

  const kinds = useMemo(() => discoverKinds(entries), [entries])
  const visibleKinds = useMemo(() => {
    const needle = typeSearch.trim().toLowerCase()
    if (!needle) return kinds
    return kinds.filter(kind => {
      const meta = fileKindMeta(kind)
      const extension = kind === 'file' ? 'no extension' : `.${kind}`
      return `${extension} ${meta.label} ${kind}`.toLowerCase().includes(needle)
    })
  }, [kinds, typeSearch])
  // Hidden files exist only in "All files" mode, so the tick-tree and "Check all" must not offer
  // them — a ticked `.env` would select a file the tree cannot show.
  const selectable = useMemo(() => entries.filter(e => !isHiddenEntry(e)), [entries])
  const allFiles = useMemo(() => selectable.filter(e => !e.isDir).map(e => e.id), [selectable])
  const visibleSelectable = useMemo(() => {
    const needle = fileSearch.trim().toLowerCase()
    if (!needle) return selectable
    return selectable.filter(entry => !entry.isDir && `${entry.name} ${entry.id}`.toLowerCase().includes(needle))
  }, [fileSearch, selectable])

  // Collapse state for the "Selected files" tree, lifted here so the toolbar can drive it.
  const [filterTreeCollapsed, setFilterTreeCollapsed] = useState<Set<string>>(new Set())
  const filterTree = useMemo(() => buildWorkspaceTree(selectable), [selectable])
  const filterTreeAllDirs = useMemo(() => collectFilterDirPaths(filterTree), [filterTree])
  const toggleFilterTreeCollapse = (path: string) => setFilterTreeCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })

  const setMode = (mode: TreeFilter['mode']) => {
    // Entering a pick-your-own mode with nothing picked would blank the tree, so each starts from the
    // scripts that are actually here — the same set the user was just looking at.
    const scripts = entries.filter(isScriptEntry)
    const next = { ...filter, mode }
    if (mode === 'selected' && filter.paths.length === 0) next.paths = scripts.map(e => e.id)
    if (mode === 'types' && filter.kinds.length === 0) {
      next.kinds = [...new Set(scripts.map(e => e.kind || 'file'))].sort()
    }
    onChange(next)
  }

  const toggleKind = (kind: string) => onChange({
    ...filter,
    kinds: filter.kinds.includes(kind)
      ? filter.kinds.filter(k => k !== kind)
      : [...filter.kinds, kind],
  })

  /** Drag the whole dialog by its title bar, clamped so it can never be dropped out of reach. */
  const startDrag = (e: React.MouseEvent) => {
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box || e.button !== 0) return
    e.preventDefault()
    const offsetX = e.clientX - box.left
    const offsetY = e.clientY - box.top
    const onMove = (ev: MouseEvent) => setDragged({
      left: clamp(ev.clientX - offsetX, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP)),
      top: clamp(ev.clientY - offsetY, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, window.innerHeight - 40)),
    })
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (!anchor) return null

  // Pinned to the trigger's right edge, then pulled back inside the viewport — the sidebar it opens
  // from is narrower than the menu itself. A dragged dialog keeps where it was dropped instead.
  const left = dragged?.left ?? clamp(
    anchor.right - MENU_WIDTH,
    VIEWPORT_GAP,
    Math.max(VIEWPORT_GAP, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP),
  )
  const top = dragged?.top ?? anchor.bottom + 4

  const dirty = !isDefaultFilter(filter)

  return (
    <div
      ref={wrapRef}
      role="group"
      aria-label="Workspace filter"
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-theme-border bg-theme-popup text-theme-fg shadow-xl"
      style={{
        left,
        top,
        width: MENU_WIDTH,
        // A workspace opened far down the sidebar must not push the menu off the bottom.
        maxHeight: Math.max(160, window.innerHeight - top - VIEWPORT_GAP),
      }}
    >
      {/* Title bar: the drag handle, and the only affordance that says this dialog can be moved. */}
      <div
        onMouseDown={startDrag}
        className="flex flex-shrink-0 cursor-move items-center gap-1 border-b border-[var(--theme-border)] px-2 py-1"
      >
        <GripHorizontal className="h-3 w-3 flex-shrink-0 text-[var(--theme-dim)]" />
        <span className="flex-1 text-[10px] uppercase tracking-wider text-[var(--theme-dim)]">Filter</span>
        <button
          type="button"
          aria-label="Close filter"
          onClick={onClose}
          className="flex-shrink-0 rounded p-0.5 text-[var(--theme-dim)] hover:bg-[var(--theme-hover-bg)] hover:text-[var(--theme-fg)]"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        {([
          ['scripts', 'Scripts only'],
          ['all', 'All files'],
          ['types', 'Selected types'],
          ['selected', 'Selected files'],
        ] as const).map(([mode, label]) => (
          <label key={mode} className="flex items-center gap-1.5 py-0.5 text-[11px] cursor-pointer">
            <input
              type="radio"
              name="workspace-filter-mode"
              checked={filter.mode === mode}
              onChange={() => setMode(mode)}
            />
            {label}
          </label>
        ))}

        {filter.mode === 'types' && (
          <div className="mt-1.5 border-t border-[var(--theme-border)] pt-1.5">
            <input
              type="search"
              aria-label="Search selected types"
              placeholder="Search types…"
              value={typeSearch}
              onChange={event => setTypeSearch(event.target.value)}
              className="mb-1 w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1 text-[10px] outline-none focus:border-[var(--theme-accent)]"
            />
            <div className="mb-1 flex items-center justify-end gap-1">
              <button type="button" onClick={() => onChange({ ...filter, kinds })} className={smallButton}>
                Check all
              </button>
              <button type="button" onClick={() => onChange({ ...filter, kinds: [] })} className={smallButton}>
                Uncheck all
              </button>
            </div>
            {kinds.length === 0
              ? <p className="text-[10px] italic text-[var(--theme-dim)]">No files in this workspace.</p>
              : visibleKinds.length === 0
                ? <p className="text-[10px] italic text-[var(--theme-dim)]">No matching file types.</p>
                : visibleKinds.map(kind => {
                const meta = fileKindMeta(kind)
                const Icon = meta.icon
                const name = kind === 'file' ? 'No extension' : `.${kind}`
                return (
                  <label
                    key={kind}
                    className="flex cursor-pointer items-center gap-1.5 rounded py-0.5 pl-1 text-[11px] hover:bg-[var(--theme-hover-bg)]"
                  >
                    <input
                      type="checkbox"
                      aria-label={name}
                      checked={filter.kinds.includes(kind)}
                      onChange={() => toggleKind(kind)}
                    />
                    <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: meta.color }} />
                    <span className="truncate">{name}</span>
                    <span className="ml-auto flex-shrink-0 text-[9px] text-[var(--theme-dim)]">{meta.label}</span>
                  </label>
                )
              })}
          </div>
        )}

        {filter.mode === 'selected' && (
          <div className="mt-1.5 border-t border-[var(--theme-border)] pt-1.5">
            <input
              type="search"
              aria-label="Search selected files"
              placeholder="Search files…"
              value={fileSearch}
              onChange={event => setFileSearch(event.target.value)}
              className="mb-1 w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1 text-[10px] outline-none focus:border-[var(--theme-accent)]"
            />
            <div className="mb-1 flex items-center justify-end gap-1">
              <button type="button" onClick={() => onChange({ ...filter, paths: allFiles })} className={smallButton}>
                Check all
              </button>
              <button type="button" onClick={() => onChange({ ...filter, paths: [] })} className={smallButton}>
                Uncheck all
              </button>
            </div>
            {/* Expand / collapse controls for the file tree */}
            <div className="mb-1 flex items-center gap-0.5">
              <button
                type="button"
                title="Collapse all folders"
                onClick={() => setFilterTreeCollapsed(new Set(filterTreeAllDirs))}
                className={smallButton + ' inline-flex items-center gap-0.5'}
              >
                <ChevronsDownUp className="w-3 h-3" />
                All
              </button>
              <button
                type="button"
                title="Expand all folders"
                onClick={() => setFilterTreeCollapsed(new Set())}
                className={smallButton + ' inline-flex items-center gap-0.5'}
              >
                <ChevronsUpDown className="w-3 h-3" />
                All
              </button>
              <span className="text-[9px] text-[var(--theme-dim)] mx-0.5">│</span>
              <button
                type="button"
                title="Expand only root folders (Level 1)"
                onClick={() => {
                  const level1 = new Set(collectFilterDirPaths(filterTree, 0))
                  const allDirs = new Set(filterTreeAllDirs)
                  // Collapse everything not in level 1
                  const next = new Set<string>()
                  for (const d of allDirs) if (!level1.has(d)) next.add(d)
                  setFilterTreeCollapsed(next)
                }}
                className={smallButton}
              >
                Lv 1
              </button>
              <button
                type="button"
                title="Expand root + second-level folders (Level 2)"
                onClick={() => {
                  const level2 = new Set(collectFilterDirPaths(filterTree, 1))
                  const allDirs = new Set(filterTreeAllDirs)
                  const next = new Set<string>()
                  for (const d of allDirs) if (!level2.has(d)) next.add(d)
                  setFilterTreeCollapsed(next)
                }}
                className={smallButton}
              >
                Lv 2
              </button>
            </div>
            <div className="custom-scrollbar max-h-64 overflow-y-auto">
              {allFiles.length === 0
                ? <p className="text-[10px] italic text-[var(--theme-dim)]">No files in this workspace.</p>
                : (
                  <WorkspaceFilterTree
                    entries={visibleSelectable}
                    paths={filter.paths}
                    onChange={(paths) => onChange({ ...filter, paths })}
                    collapsed={filterTreeCollapsed}
                    onToggleCollapse={toggleFilterTreeCollapse}
                  />
                )}
            </div>
          </div>
        )}

        <label className="mt-1.5 flex items-center gap-1.5 border-t border-[var(--theme-border)] pt-1.5 text-[11px] cursor-pointer">
          <input
            type="checkbox"
            checked={filter.showEmptyDirs}
            onChange={() => onChange({ ...filter, showEmptyDirs: !filter.showEmptyDirs })}
          />
          Show empty folders
        </label>
        {dirty && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_TREE_FILTER)}
            className={`mt-1 w-full text-left ${smallButton}`}
          >
            Reset to default
          </button>
        )}
      </div>
    </div>
  )
}

export default WorkspaceFilterMenu
