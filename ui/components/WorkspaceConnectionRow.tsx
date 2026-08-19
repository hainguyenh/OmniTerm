import React from 'react'
import { Monitor, Pencil, Play, Terminal, Trash2 } from 'lucide-react'
import type { Connection } from '@omniterm/contract'
import { Tooltip } from './Tooltip'

/**
 * A saved connection, rendered as a leaf of the workspace tree inside the folder its `parentId`
 * names — right next to the scripts it goes with.
 *
 * Its actions mirror a file row's: the primary one (connect) is a double-click or the play button,
 * and edit/delete only appear on hover so a dense tree stays readable.
 */
interface WorkspaceConnectionRowProps {
  connection: Connection
  /** Indent level in the tree, in the same units the file and folder rows use. */
  depth: number
  onConnect?: (conn: Connection) => void
  /** Absent when the host offers no edit affordance (e.g. a plugin-free build). */
  onEdit?: (conn: Connection) => void
  onDelete: (conn: Connection) => void
}

const typeIconFor = (type: Connection['type']) => {
  if (type === 'RDP') return <Monitor className="w-4 h-4 flex-shrink-0 text-[#bb9af7]" />
  const tint = type === 'SSH' ? 'text-[#7dcfff]' : 'text-[#9ece6a]'
  return <Terminal className={`w-4 h-4 flex-shrink-0 ${tint}`} />
}

const hoverAction = 'flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--theme-bg)] transition'

const WorkspaceConnectionRow: React.FC<WorkspaceConnectionRowProps> = ({
  connection, depth, onConnect, onEdit, onDelete,
}) => (
  <div
    className="group flex items-center gap-2 pr-1 py-1 rounded bg-[var(--theme-bg)] cursor-pointer hover:bg-[var(--theme-hover-bg)]"
    style={{ paddingLeft: 8 + depth * 12 }}
    onDoubleClick={() => onConnect?.(connection)}
    title={connection.type !== 'LOCAL'
      ? `${connection.user ? connection.user + '@' : ''}${connection.host}:${connection.port}`
      : connection.name}
  >
    {typeIconFor(connection.type)}
    <span className="flex-1 truncate text-xs">{connection.name}</span>
    <span className="text-[9px] text-[var(--theme-dim)] uppercase mr-1">{connection.type}</span>
    <Tooltip content="Connect" placement="bottom">
      <button
        type="button"
        aria-label="Connect"
        onClick={(e) => { e.stopPropagation(); onConnect?.(connection) }}
        className={`${hoverAction} text-[var(--theme-accent)]`}
      >
        <Play className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
    {onEdit && (
      <Tooltip content="Edit connection" placement="bottom">
        <button
          type="button"
          aria-label="Edit connection"
          onClick={(e) => { e.stopPropagation(); onEdit(connection) }}
          className={`${hoverAction} text-[var(--theme-dim)] hover:text-[var(--theme-fg)]`}
        >
          <Pencil className="w-3 h-3" />
        </button>
      </Tooltip>
    )}
    <Tooltip content="Delete connection" placement="bottom">
      <button
        type="button"
        aria-label="Delete connection"
        onClick={(e) => { e.stopPropagation(); onDelete(connection) }}
        className={`${hoverAction} text-[var(--theme-dim)] hover:text-red-400`}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </Tooltip>
  </div>
)

export default WorkspaceConnectionRow
