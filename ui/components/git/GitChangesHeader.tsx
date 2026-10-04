import React from 'react'
import {
  Archive,
  CheckSquare,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderTree,
  List,
  RefreshCw,
  Search,
  Square,
  Undo2,
  X,
} from 'lucide-react'
import { Tooltip } from '../Tooltip'

interface GitChangesHeaderProps {
  totalFiles: number
  allChecked: boolean
  someChecked: boolean
  reverting: boolean
  loading: boolean
  viewMode: 'tree' | 'list'
  search: string
  onToggleAll: () => void
  onRevertSelected: () => void
  onExpandAll: () => void
  onCollapseAll: () => void
  onToggleViewMode: () => void
  onOpenStash?: () => void
  onRefresh: () => void
  onChangeSearch: (val: string) => void
}

export const GitChangesHeader: React.FC<GitChangesHeaderProps> = ({
  totalFiles,
  allChecked,
  someChecked,
  reverting,
  loading,
  viewMode,
  search,
  onToggleAll,
  onRevertSelected,
  onExpandAll,
  onCollapseAll,
  onToggleViewMode,
  onOpenStash,
  onRefresh,
  onChangeSearch,
}) => {
  return (
    <div className="git-changes-header flex flex-col gap-3">
      <div className="git-changes-heading">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onToggleAll}
            className="git-icon-button"
            title={allChecked ? 'Deselect all' : 'Select all'}
            aria-label={allChecked ? 'Deselect all' : 'Select all'}
            aria-pressed={allChecked}
            disabled={totalFiles === 0}
          >
            {allChecked ? <CheckSquare className="text-theme-accent" /> : <Square />}
          </button>
          <span className="font-semibold text-[13px] text-theme-fg">Local Changes</span>
          <span className="git-count">({totalFiles})</span>
        </div>
        <div className="git-changes-repository-actions">
          {onOpenStash && (
            <Tooltip content="Save or manage stashed changes" placement="bottom">
              <button type="button" onClick={onOpenStash} aria-label="Git Stashes" className="git-control">
                <Archive />
                <span>Stash</span>
              </button>
            </Tooltip>
          )}
          <Tooltip content="Refresh Git status" placement="bottom">
            <button type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh Git status" className="git-icon-button">
              <RefreshCw className={loading ? 'animate-spin' : ''} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="git-search">
        <Search className="w-4 h-4 text-theme-dim flex-shrink-0" />
        <input
          type="search"
          value={search}
          onChange={(e) => onChangeSearch(e.target.value)}
          placeholder="Filter changed files…"
          aria-label="Search changed files"
        />
        {search && (
          <button type="button" onClick={() => onChangeSearch('')} aria-label="Clear file search" className="git-icon-button">
            <X />
          </button>
        )}
      </div>

      <div className="git-changes-list-controls">
        <Tooltip content={viewMode === 'tree' ? 'Switch to List view' : 'Switch to Tree view'} placement="bottom">
          <button
            type="button"
            onClick={onToggleViewMode}
            aria-label={viewMode === 'tree' ? 'Switch to List view' : 'Switch to Tree view'}
            className="git-control"
          >
            {viewMode === 'tree' ? <FolderTree className="text-theme-accent" /> : <List className="text-theme-accent" />}
            <span>{viewMode === 'tree' ? 'Tree' : 'List'}</span>
          </button>
        </Tooltip>
        {viewMode === 'tree' && (
          <>
            <Tooltip content="Expand all folders" placement="bottom">
              <button type="button" onClick={onExpandAll} aria-label="Expand all folders" className="git-icon-button">
                <ChevronsUpDown />
              </button>
            </Tooltip>
            <Tooltip content="Collapse all folders" placement="bottom">
              <button type="button" onClick={onCollapseAll} aria-label="Collapse all folders" className="git-icon-button">
                <ChevronsDownUp />
              </button>
            </Tooltip>
          </>
        )}
        {someChecked && (
          <Tooltip content="Discard selected changes" placement="bottom">
            <button type="button" onClick={onRevertSelected} disabled={reverting} aria-label="Discard selected changes" className="git-control git-control-danger">
              <Undo2 />
              <span>Discard</span>
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
