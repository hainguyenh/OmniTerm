import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'

import { FileTypeIcon } from '../FileTypeIcon'
import { buildGitTree, getFileExtension, type GitTreeNode } from './gitTreeUtils'
import type { GitFileChange } from './gitTypes'
import './git-branch-dialog.css'

interface GitBranchDiffFileTreeProps {
  files: GitFileChange[]
  onOpenFile: (path: string) => void
}

const STATUS_CODES: Partial<Record<GitFileChange['staged'], { code: string; className: string }>> = {
  added: { code: 'A', className: 'git-status-added' },
  deleted: { code: 'D', className: 'git-status-deleted' },
  renamed: { code: 'R', className: 'git-status-renamed' },
}
const MODIFIED = { code: 'M', className: 'git-status-modified' }

function indent(depth: number) {
  return { paddingInlineStart: `${Math.min(depth, 8) * 16 + 12}px` }
}

/** Files that differ between two branches, grouped by folder like the local changes tree. */
export function GitBranchDiffFileTree({ files, onOpenFile }: GitBranchDiffFileTreeProps) {
  const nodes = useMemo(() => buildGitTree(files), [files])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderNodes = (list: GitTreeNode[], depth: number): ReactNode => list.map((node) => {
    if (node.type === 'folder') {
      const isCollapsed = collapsed.has(node.path)
      return (
        <div key={`d:${node.path}`} role="group" aria-label={node.path}>
          <button
            type="button"
            className="git-branch-diff-folder"
            style={indent(depth)}
            aria-expanded={!isCollapsed}
            title={node.path}
            onClick={() => toggle(node.path)}
          >
            {isCollapsed ? <ChevronRight /> : <ChevronDown />}
            {isCollapsed ? <Folder className="text-theme-warning" /> : <FolderOpen className="text-theme-warning" />}
            <span className="truncate">{node.name}</span>
            <span className="git-count">{node.allFiles.length}</span>
          </button>
          {!isCollapsed && renderNodes(node.children, depth + 1)}
        </div>
      )
    }
    const status = STATUS_CODES[node.file.staged] ?? MODIFIED
    return (
      <button
        key={`f:${node.path}`}
        type="button"
        className="git-branch-diff-file"
        style={indent(depth)}
        title={node.path}
        aria-label={`View diff for ${node.path}`}
        onClick={() => onOpenFile(node.path)}
      >
        <FileTypeIcon name={node.path} kind={getFileExtension(node.path)} />
        <span className="truncate">{node.name}</span>
        <span className={`git-status-badge ${status.className}`}>{status.code}</span>
        <span className="git-branch-diff-open">View diff<ChevronRight /></span>
      </button>
    )
  })

  return <div className="git-branch-diff-tree">{renderNodes(nodes, 0)}</div>
}
