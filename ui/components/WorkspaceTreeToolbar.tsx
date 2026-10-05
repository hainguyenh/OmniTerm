import React from 'react'
import {
  ChevronsDownUp, ChevronsUpDown, Filter, List, ListTree, RefreshCw,
} from 'lucide-react'

import { filterSummary, isDefaultFilter, type TreeFilter } from '../utils/workspaceFilter'
import { Tooltip } from './Tooltip'

/**
 * The row of controls above one expanded workspace's tree.
 *
 * Keep view controls together and give the active filter one clearly labelled trigger.
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

const iconButton = 'workspace-icon-button'

const WorkspaceTreeToolbar: React.FC<WorkspaceTreeToolbarProps> = ({
  filter, fileCount, onOpenFilterMenu, filterMenuOpen,
  allCollapsed, onToggleCollapseAll, flatView, onToggleFlatView, scanning, onRescan,
}) => {
  // Keep the active filter visible without requiring the popover to be opened.
  const filterTint = isDefaultFilter(filter)
    ? 'text-[var(--theme-dim)] hover:text-[var(--theme-fg)]'
    : 'text-[var(--theme-accent)]'

  return (
    <div className="workspace-tree-toolbar" role="group" aria-label="Workspace tree controls">
      <Tooltip content="Filter what this workspace shows" placement="bottom">
        <button
          type="button"
          data-filter-trigger
          aria-label="Filter what this workspace shows"
          aria-expanded={filterMenuOpen}
          onClick={(e) => onOpenFilterMenu(e.currentTarget.getBoundingClientRect())}
          className={`workspace-filter-trigger ${filterTint}`}
          data-active={!isDefaultFilter(filter)}
        >
          <Filter aria-hidden="true" />
          <span>{filterSummary(filter, fileCount)}</span>
        </button>
      </Tooltip>

      <div className="workspace-view-actions">
        {allCollapsed !== null && (
          <Tooltip content={allCollapsed ? 'Expand all' : 'Collapse all'} placement="bottom">
            <button
              type="button"
              aria-label={allCollapsed ? 'Expand all' : 'Collapse all'}
              onClick={onToggleCollapseAll}
              className={iconButton}
            >
              {allCollapsed
                ? <ChevronsUpDown className="w-3.5 h-3.5" />
                : <ChevronsDownUp className="w-3.5 h-3.5" />}
            </button>
          </Tooltip>
        )}
        <Tooltip content={flatView ? 'Show as tree' : 'Flatten'} placement="bottom">
          <button
            type="button"
            aria-label={flatView ? 'Show as tree' : 'Flatten'}
            aria-pressed={flatView}
            onClick={onToggleFlatView}
            className={iconButton}
          >
            {flatView ? <ListTree className="w-3.5 h-3.5" /> : <List className="w-3.5 h-3.5" />}
          </button>
        </Tooltip>
        <Tooltip content="Rescan" placement="bottom">
          <button type="button" aria-label="Rescan" disabled={scanning} aria-busy={scanning} onClick={onRescan} className={iconButton}>
            <RefreshCw className={`w-3 h-3 ${scanning ? 'animate-spin' : ''}`} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

export default WorkspaceTreeToolbar
