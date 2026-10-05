import { Monitor, Pencil, Play, Terminal, Trash2 } from 'lucide-react'
import type { Connection } from '@omniterm/contract'
import type { CSSProperties } from 'react'

import { Tooltip } from './Tooltip'
import { useRowContextMenu } from './useRowContextMenu'
import { WorkspaceRowActions } from './WorkspaceRowActions'

interface WorkspaceConnectionRowProps {
  connection: Connection
  depth: number
  onConnect?: (connection: Connection) => void
  onEdit?: (connection: Connection) => void
  onDelete: (connection: Connection) => void
}

export default function WorkspaceConnectionRow({
  connection, depth, onConnect, onEdit, onDelete,
}: WorkspaceConnectionRowProps) {
  const Icon = connection.type === 'RDP' ? Monitor : Terminal
  const { actionsRef, onContextMenu } = useRowContextMenu()
  return (
    <div
      className="workspace-connection-row"
      style={{ '--tree-depth': depth } as CSSProperties}
      onDoubleClick={() => onConnect?.(connection)}
      onContextMenu={onContextMenu}
      title={connection.type !== 'LOCAL'
        ? `${connection.user ? connection.user + '@' : ''}${connection.host}:${connection.port}`
        : connection.name}
    >
      <Icon className="workspace-connection-icon" aria-hidden="true" />
      <button
        type="button"
        className="workspace-row-label"
        disabled={!onConnect}
        onDoubleClick={event => {
          event.stopPropagation()
          onConnect?.(connection)
        }}
        onClick={event => { if (event.detail === 0) onConnect?.(connection) }}
      >
        {connection.name}
      </button>
      <span className="workspace-connection-type">{connection.type}</span>
      {onConnect && (
        <Tooltip content="Connect" placement="bottom">
          <button
            type="button"
            aria-label="Connect"
            className="workspace-icon-button workspace-run-action"
            onClick={event => {
              event.stopPropagation()
              onConnect(connection)
            }}
            onDoubleClick={event => event.stopPropagation()}
          >
            <Play aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      <WorkspaceRowActions ref={actionsRef} label={`Actions for ${connection.name}`} items={[
        ...(onConnect ? [{ label: 'Connect', icon: Play, onSelect: () => onConnect(connection) }] : []),
        ...(onEdit ? [{ label: 'Edit connection', icon: Pencil, onSelect: () => onEdit(connection) }] : []),
        { label: 'Delete connection', icon: Trash2, onSelect: () => onDelete(connection), danger: true },
      ]} />
    </div>
  )
}
