import React, { useMemo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { WorkspaceEntry } from '@omniterm/contract'
import { buildWorkspaceTree, type WorkspaceTreeNode } from '../utils/scriptTree'
import { fileKindMeta } from '../utils/fileKind'

/**
 * The checkbox tree inside the filter popover: the workspace's own folders and files, ticked to build
 * a "show exactly these" selection.
 *
 * It renders the real directory tree rather than a flat list because that is the shape the user
 * already has in their head, and because a folder tick has to be able to speak for everything under
 * it — picking 30 files one at a time is not a filter anyone uses twice.
 *
 * Collapse state is lifted to the parent so it can offer expand/collapse-all and level-based controls.
 */
interface WorkspaceFilterTreeProps {
  /** The whole scan for this workspace. */
  entries: WorkspaceEntry[]
  /** Currently ticked entry ids. */
  paths: string[]
  onChange: (paths: string[]) => void
  /** Folder paths that are currently collapsed (lifted state from parent). */
  collapsed: Set<string>
  /** Toggle collapse for a single folder path. */
  onToggleCollapse: (path: string) => void
}

/** Every file id at or beneath `node`, so a folder's checkbox can speak for its whole subtree. */
function filesUnder(node: WorkspaceTreeNode): string[] {
  if (!node.isDir) return node.entry ? [node.path] : []
  return node.children.flatMap(filesUnder)
}

const WorkspaceFilterTree: React.FC<WorkspaceFilterTreeProps> = ({ entries, paths, onChange, collapsed, onToggleCollapse }) => {
  // Passed without connections: those are never filtered, so they have no place in the tree the user
  // ticks files out of. No workspace-root row either — the panel already names the workspace.
  const tree = useMemo(() => buildWorkspaceTree(entries), [entries])
  const chosen = useMemo(() => new Set(paths), [paths])

  /** Tick or untick a whole subtree (or a single file) in one write. */
  const toggleSubtree = (node: WorkspaceTreeNode) => {
    const ids = filesUnder(node)
    if (ids.length === 0) return
    const next = new Set(chosen)
    const anyOff = ids.some(id => !next.has(id))
    for (const id of ids) anyOff ? next.add(id) : next.delete(id)
    onChange([...next])
  }

  const renderNode = (node: WorkspaceTreeNode, depth: number): React.ReactNode => {
    if (node.connection) return null
    if (!node.isDir) {
      const meta = fileKindMeta(node.entry?.kind ?? '')
      const Icon = meta.icon
      return (
        <label
          key={node.path}
          className="flex items-center gap-1.5 py-0.5 text-[11px] cursor-pointer rounded hover:bg-[var(--theme-hover-bg)]"
          style={{ paddingLeft: 4 + depth * 12 }}
        >
          <input type="checkbox" checked={chosen.has(node.path)} onChange={() => toggleSubtree(node)} />
          <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: meta.color }} />
          <span className="truncate">{node.name}</span>
        </label>
      )
    }

    const ids = filesUnder(node)
    const ticked = ids.filter(id => chosen.has(id)).length
    const isCollapsed = collapsed.has(node.path)
    return (
      <div key={node.path}>
        <div
          className="flex items-center gap-1 py-0.5 text-[11px] rounded hover:bg-[var(--theme-hover-bg)]"
          style={{ paddingLeft: 4 + depth * 12 }}
        >
          <button
            type="button"
            title={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
            onClick={() => onToggleCollapse(node.path)}
            className="flex-shrink-0 text-[var(--theme-dim)] hover:text-[var(--theme-fg)]"
          >
            {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {/* A folder with nothing filterable under it has nothing to tick, so it gets no box. */}
          {ids.length > 0 && (
            <input
              type="checkbox"
              aria-label={node.name}
              checked={ticked === ids.length}
              // Partly-ticked folders read as indeterminate rather than as "off".
              ref={el => { if (el) el.indeterminate = ticked > 0 && ticked < ids.length }}
              onChange={() => toggleSubtree(node)}
            />
          )}
          <span className="truncate text-[var(--theme-fg)]">{node.name}</span>
        </div>
        {!isCollapsed && node.children.map(c => renderNode(c, depth + 1))}
      </div>
    )
  }

  return <>{tree.map(node => renderNode(node, 0))}</>
}

export default WorkspaceFilterTree

