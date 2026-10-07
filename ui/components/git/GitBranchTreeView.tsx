import { ChevronDown, ChevronRight, Folder, FolderOpen, GitBranch, GitFork, MoreHorizontal, Star } from 'lucide-react'
import { useState } from 'react'

import { pointBelow, type MenuPoint } from './gitMenuPlacement'
import type { GitBranchTreeNode } from './gitBranchTreeUtils'
import type { GitBranchInfo } from './gitTypes'
import { GitBranchSubmenu } from './GitBranchSubmenu'

interface GitBranchTreeViewProps {
  nodes: GitBranchTreeNode[]
  currentBranch?: string
  selectedBranch: GitBranchInfo | null
  depth?: number
  collapsed?: boolean
  isFavorite?: (branchName: string) => boolean
  onToggleFavorite?: (branchName: string) => void
  onSelectBranch: (branch: GitBranchInfo | null) => void
  /** Open the actions menu for `branch` at `point` (where the user right-clicked). */
  onContextBranch?: (branch: GitBranchInfo, point: MenuPoint) => void
  onCheckout?: (branch: string) => void
  onPull?: (branch: string) => void
  onMerge?: (branch: string) => void
  onRebase?: (branch: string) => void
  onCompare?: (branch: string) => void
  onNewBranchFrom?: (branch: string) => void
  onDeleteBranch?: (branch: string) => void
}

export function GitBranchTreeView({
  nodes, currentBranch, selectedBranch, depth = 0, collapsed = false,
  isFavorite, onToggleFavorite,
  onSelectBranch, onContextBranch, ...legacyActions
}: GitBranchTreeViewProps) {
  const [folderOverrides, setFolderOverrides] = useState<Record<string, boolean>>({})

  return (
    <div className={depth ? 'git-branch-tree-children' : 'git-branch-tree'}>
      {nodes.map((node) => {
        if (node.type === 'folder') {
          const isCollapsed = folderOverrides[node.path] ?? collapsed
          const FolderIcon = isCollapsed ? Folder : FolderOpen
          return (
            <div key={node.path}>
              <button
                type="button"
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} branch folder ${node.path}`}
                onClick={() => setFolderOverrides((previous) => ({ ...previous, [node.path]: !isCollapsed }))}
                className="git-branch-folder"
                style={{ paddingInlineStart: 12 + depth * 18 }}
              >
                {isCollapsed ? <ChevronRight /> : <ChevronDown />}
                <FolderIcon />
                <span>{node.name}</span>
                <small>{node.allBranches.length}</small>
              </button>
              {!isCollapsed && <GitBranchTreeView
                nodes={node.children}
                currentBranch={currentBranch}
                selectedBranch={selectedBranch}
                depth={depth + 1}
                collapsed={collapsed}
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
                onSelectBranch={onSelectBranch}
                onContextBranch={onContextBranch}
                {...legacyActions}
              />}
            </div>
          )
        }

        const branch = node.branch
        const isCurrent = branch.name === currentBranch || branch.is_current
        const isSelected = selectedBranch?.name === branch.name && selectedBranch.is_remote === branch.is_remote
        const isFav = isFavorite?.(branch.name) ?? false
        return (
          <div key={branch.name}>
          <div className={`git-branch-leaf ${isSelected ? 'is-selected' : ''}`}>
            {onToggleFavorite && (
              <button
                type="button"
                className={`git-branch-star git-icon-button ${isFav ? 'is-favorite' : ''}`}
                aria-label={isFav ? `Remove ${branch.name} from favorites` : `Add ${branch.name} to favorites`}
                title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleFavorite(branch.name)
                }}
              >
                <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-400 text-amber-400' : 'text-theme-dim'}`} />
              </button>
            )}
            <button
              type="button"
              className="git-branch-select"
              aria-pressed={isSelected}
              aria-expanded={onContextBranch ? undefined : isSelected}
              aria-label={`Branch ${branch.name}${isCurrent ? ', current branch' : ''}`}
              style={{ paddingInlineStart: 30 + depth * 18 }}
              onClick={() => onSelectBranch(!onContextBranch && isSelected ? null : branch)}
              onContextMenu={(event) => {
                event.preventDefault()
                if (onContextBranch) onContextBranch(branch, { x: event.clientX, y: event.clientY })
                else onSelectBranch(branch)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault()
                  if (onContextBranch) onContextBranch(branch, pointBelow(event.currentTarget))
                  else onSelectBranch(branch)
                }
              }}
            >
              {branch.is_remote ? <GitFork /> : <GitBranch />}
              <span className="git-branch-name" title={branch.name}>{node.displayName}</span>
              {isCurrent && <span className="git-branch-current">HEAD</span>}
              {branch.ahead > 0 && <small className="git-branch-ahead" title={`${branch.ahead} commits ahead`}>↑{branch.ahead}</small>}
              {branch.behind > 0 && <small className="git-branch-behind" title={`${branch.behind} commits behind`}>↓{branch.behind}</small>}
              {branch.is_gone && <span className="git-branch-gone">Gone</span>}
            </button>
            <button
              type="button"
              className="git-branch-more git-icon-button"
              aria-label={`Actions for ${branch.name}`}
              onClick={(event) => {
                if (onContextBranch) onContextBranch(branch, pointBelow(event.currentTarget))
                else onSelectBranch(branch)
              }}
            ><MoreHorizontal /></button>
          </div>
          {!onContextBranch && isSelected && legacyActions.onCheckout && legacyActions.onMerge && legacyActions.onRebase && legacyActions.onNewBranchFrom && <GitBranchSubmenu
            branch={branch}
            currentBranch={currentBranch}
            inline
            isFavorite={isFav}
            onToggleFavorite={onToggleFavorite}
            onCheckout={legacyActions.onCheckout}
            onPull={legacyActions.onPull}
            onMerge={legacyActions.onMerge}
            onRebase={legacyActions.onRebase}
            onCompare={legacyActions.onCompare}
            onNewBranchFrom={legacyActions.onNewBranchFrom}
            onDelete={legacyActions.onDeleteBranch}
            onClose={() => onSelectBranch(null)}
          />}
          </div>
        )
      })}
    </div>
  )
}
