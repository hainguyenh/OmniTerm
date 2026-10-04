import React from 'react'
import { CheckSquare, ChevronDown, ChevronRight, Folder, FolderOpen, MinusSquare, Square } from 'lucide-react'

import { GitFileRow } from './GitFileRow'
import { getFolderCheckState } from './gitTreeUtils'
import type { GitTreeFolderNode, GitTreeNode } from './gitTreeUtils'

interface GitChangesTreeProps {
  nodes: GitTreeNode[]
  isStaged: boolean
  checkedPaths: Set<string>
  collapsedFolders: Set<string>
  selectedFile: string | null
  staging: boolean
  depth?: number
  onToggleCheck: (path: string, event: React.MouseEvent) => void
  onToggleFolderCheck: (folder: GitTreeFolderNode, event: React.MouseEvent) => void
  onToggleFolder: (path: string, event: React.MouseEvent) => void
  onSelectFile: (path: string, staged: boolean) => void
  onToggleStage: (path: string, staged: boolean) => void
  onContextMenu: (event: React.MouseEvent, path: string, staged: boolean) => void
}

export const GitChangesTree: React.FC<GitChangesTreeProps> = (props) => {
  const { nodes, isStaged, checkedPaths, collapsedFolders, selectedFile, staging, depth = 0 } = props

  return (
    <div className="flex flex-col">
      {nodes.map((node) => {
        if (node.type === 'file') {
          return (
            <GitFileRow
              key={node.file.path}
              file={node.file}
              displayName={node.name}
              depth={depth}
              isChecked={checkedPaths.has(node.file.path)}
              isSelected={selectedFile === node.file.path}
              isStaged={isStaged}
              staging={staging}
              onToggleCheck={props.onToggleCheck}
              onSelect={props.onSelectFile}
              onToggleStage={props.onToggleStage}
              onContextMenu={props.onContextMenu}
            />
          )
        }

        const isCollapsed = collapsedFolders.has(node.path)
        const { checked, indeterminate } = getFolderCheckState(node, checkedPaths)
        return (
          <div key={node.path}>
            <div className="git-folder-row" style={{ paddingInlineStart: `${Math.min(depth, 6) * 16 + 8}px` }}>
              <button
                type="button"
                onClick={(e) => props.onToggleFolderCheck(node, e)}
                className="git-icon-button git-check-button"
                aria-label={`${checked ? 'Deselect' : 'Select'} folder ${node.path}`}
                aria-pressed={indeterminate ? 'mixed' : checked}
              >
                {checked ? <CheckSquare className="text-theme-accent" /> : indeterminate ? <MinusSquare className="text-theme-accent" /> : <Square />}
              </button>
              <button
                type="button"
                onClick={(e) => props.onToggleFolder(node.path, e)}
                className="git-folder-toggle"
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} folder ${node.path}`}
                title={node.path}
              >
                {isCollapsed ? <ChevronRight className="text-theme-dim" /> : <ChevronDown className="text-theme-dim" />}
                {isCollapsed ? <Folder className="text-theme-warning" /> : <FolderOpen className="text-theme-warning" />}
                <span className="truncate">{node.name}</span>
              </button>
              <span className="git-count">{node.allFiles.length}</span>
            </div>
            {!isCollapsed && <GitChangesTree {...props} nodes={node.children} depth={depth + 1} />}
          </div>
        )
      })}
    </div>
  )
}

interface GitChangeGroupProps {
  title: string
  count: number
  isExpanded: boolean
  onToggle: () => void
  actionButton?: React.ReactNode
}

export const GitChangeGroup: React.FC<GitChangeGroupProps> = ({ title, count, isExpanded, onToggle, actionButton }) => (
  <div className="git-change-group">
    <button type="button" onClick={onToggle} className="git-change-group-toggle" aria-expanded={isExpanded}>
      {isExpanded ? <ChevronDown className="w-4 h-4 text-theme-dim" /> : <ChevronRight className="w-4 h-4 text-theme-dim" />}
      <span className="font-semibold truncate">{title}</span>
      <span className="git-count">{count}</span>
    </button>
    {actionButton}
  </div>
)
