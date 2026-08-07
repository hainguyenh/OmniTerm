import React from 'react'
import {
  ChevronsDownUp, ChevronsUpDown, Filter, List, ListTree, RefreshCw,
} from 'lucide-react'
import { filterSummary, isDefaultFilter, type TreeFilter } from '../utils/workspaceFilter'

/**
 * The row of controls above one expanded workspace's tree.
 *
 * The left-hand label states what the tree is currently showing — a filter you can only infer from a
 * tinted funnel is a filter users forget is on — and doubles as a second trigger for the same
 * popover. Everything on the right is `flex-shrink-0` so the label, not the controls, is what gives
 * way in a narrow sidebar.
 */
interface WorkspaceTreeToolbarProps {
  filter: TreeFilter
  /** How many files the filter admitted, for the label's count in "selected" mode. */
  fileCount: number
  /** Open the filter popover, pinned to the trigger that was clicked. */
  onOpenFilterMenu: (anchor: DOMRect) => void
  filterMenuOpen: boolean
  /**
   * Collapse state of every folder in the tree: `null` when there is nothing collapsible (a flat
   * view, or a tree with no folders), in which case the expand/collapse-all button is not offered.
   */
  allCollapsed: boolean | null
  onToggleCollapseAll: () => void
  flatView: boolean
  onToggleFlatView: () => void
  scanning: boolean
  onRescan: () => void
}

const iconButton = 'flex-shrink-0 p-0.5 rounded hover:bg-[var(--theme-hover-bg)] text-[var(--theme-dim)] hover:text-[var(--theme-fg)]'

const WorkspaceTreeToolbar: React.FC<WorkspaceTreeToolbarProps> = ({
  filter, fileCount, onOpenFilterMenu, filterMenuOpen,
  allCollapsed, onToggleCollapseAll, flatView, onToggleFlatView, scanning, onRescan,
}) => {
  // Both filter triggers share this tint, so an active filter is visible without opening anything.
  const filterTint = isDefaultFilter(filter)
    ? 'text-[var(--theme-dim)] hover:text-[var(--theme-fg)]'
    : 'text-[var(--theme-accent)]'

  return (
    <div className="flex items-center justify-between gap-1 px-2 py-0.5">
      <button
        type="button"
        title="Filter what this workspace shows"
        data-filter-trigger
        onClick={(e) => onOpenFilterMenu(e.currentTarget.getBoundingClientRect())}
        className={`min-w-0 truncate rounded px-1 text-[10px] uppercase tracking-wider hover:bg-[var(--theme-hover-bg)] ${filterTint}`}
      >
        {filterSummary(filter, fileCount)}
      </button>

      <div className="flex flex-shrink-0 items-center gap-0.5">
        {allCollapsed !== null && (
          <button
            type="button"
            title={allCollapsed ? 'Expand all' : 'Collapse all'}
            onClick={onToggleCollapseAll}
            className={iconButton}
          >
            {allCollapsed
              ? <ChevronsUpDown className="w-3.5 h-3.5" />
              : <ChevronsDownUp className="w-3.5 h-3.5" />}
          </button>
        )}
        <button
          type="button"
          title="Filter what this workspace shows"
          data-filter-trigger
          aria-label="Filter workspace contents"
          aria-expanded={filterMenuOpen}
          onClick={(e) => onOpenFilterMenu(e.currentTarget.getBoundingClientRect())}
          className={`flex-shrink-0 p-0.5 rounded hover:bg-[var(--theme-hover-bg)] ${filterTint}`}
        >
          <Filter className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title={flatView ? 'Show as tree' : 'Flatten'}
          onClick={onToggleFlatView}
          className={iconButton}
        >
          {flatView ? <ListTree className="w-3.5 h-3.5" /> : <List className="w-3.5 h-3.5" />}
        </button>
        <button type="button" title="Rescan" onClick={onRescan} className={iconButton}>
          <RefreshCw className={`w-3 h-3 ${scanning ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  )
}

export default WorkspaceTreeToolbar
