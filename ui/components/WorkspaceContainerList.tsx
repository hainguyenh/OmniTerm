import { useState, type ReactNode } from 'react'
import type { Workspace } from '@omniterm/contract'
import { buildWorkspaceForest, siblingPosition, workspaceDropIndex } from '../utils/workspaceHierarchy'
import WorkspaceRootRow from './WorkspaceRootRow'

interface WorkspaceContainerListProps {
  workspaces: Workspace[]
  expandedId: string | null
  onToggle: (workspaceId: string) => void
  onAddFolder: (workspaceId: string) => void
  onRemove: (workspaceId: string) => void
  onRename?: (workspaceId: string, name: string) => void
  onMove: (workspaceId: string, parentId: string | null, index: number) => void
  renderExpanded: (workspace: Workspace) => ReactNode
}

export default function WorkspaceContainerList({
  workspaces,
  expandedId,
  onToggle,
  onAddFolder,
  onRemove,
  onRename,
  onMove,
  renderExpanded,
}: WorkspaceContainerListProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const forest = buildWorkspaceForest(workspaces)

  const renderNode = (node: (typeof forest)[number], depth: number): ReactNode => {
    const { workspace } = node
    const position = siblingPosition(workspaces, workspace.id)
    const expanded = expandedId === workspace.id
    return (
      <div key={workspace.id} className="flex flex-col">
        <WorkspaceRootRow
          workspace={workspace}
          expanded={expanded}
          depth={depth}
          onToggle={() => onToggle(workspace.id)}
          onAddFolder={() => onAddFolder(workspace.id)}
          onRemove={() => onRemove(workspace.id)}
          onRename={onRename}
          onDragStart={event => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', workspace.id)
            setDraggingId(workspace.id)
          }}
          onDragOver={event => {
            if (draggingId && draggingId !== workspace.id) event.preventDefault()
          }}
          onDrop={event => {
            event.preventDefault()
            const source = draggingId ?? event.dataTransfer.getData('text/plain')
            setDraggingId(null)
            if (!source || source === workspace.id || !position) return
            const box = event.currentTarget.getBoundingClientRect()
            const ratio = box.height > 0 ? (event.clientY - box.top) / box.height : 0.5
            if (ratio < 0.25 || ratio > 0.75) {
              const drop = workspaceDropIndex(workspaces, source, workspace.id, ratio < 0.25 ? 'before' : 'after')
              if (drop) onMove(source, drop.parentId, drop.index)
            } else onMove(source, workspace.id, node.children.length)
          }}
        />
        {expanded && renderExpanded(workspace)}
        {node.children.map(child => renderNode(child, depth + 1))}
      </div>
    )
  }

  return <>{forest.map(node => renderNode(node, 0))}</>
}
