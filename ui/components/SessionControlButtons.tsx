import { Eraser, ExternalLink, Maximize2, Minimize2, Square } from 'lucide-react'
import type { Connection } from '@omniterm/contract'
import { detachTitle, type DetachAction } from '../detachControl'
import SessionPersistenceMenu from './SessionPersistenceMenu'
import { Tooltip, type TooltipPlacement } from './Tooltip'

interface SessionControlButtonsProps {
  conn: Connection
  sessionId: string
  busy?: boolean
  isAgent: boolean
  detach: DetachAction | null
  onToggleDetach: () => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  tooltipPlacement?: TooltipPlacement
  detachWhere?: 'pane' | 'footer'
  className?: string
}

const buttonClass = 'w-4 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors'

export default function SessionControlButtons({
  conn,
  sessionId,
  busy,
  isAgent,
  detach,
  onToggleDetach,
  fullscreen = false,
  onToggleFullscreen,
  tooltipPlacement = 'bottom',
  detachWhere = 'footer',
  className = '',
}: SessionControlButtonsProps) {
  const sendInput = (data: string) => {
    const api = window.omnitermAPI?.connect
    if (!api) return
    if (conn.type === 'SSH') api.sshInput?.(sessionId, data)
    else if (conn.type === 'LOCAL') api.localInput?.(sessionId, data)
  }

  return (
    <span className={`inline-flex items-center gap-0.5 flex-shrink-0 ${className}`}>
      {conn.type !== 'RDP' && (
        <>
          <Tooltip content="Stop current process (Ctrl+C)" placement={tooltipPlacement}>
            <button
              type="button"
              disabled={!busy}
              onClick={(event) => { event.stopPropagation(); sendInput('\x03') }}
              className={`${buttonClass} hover:bg-theme-error/20 hover:text-theme-error disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-theme-dim`}
              aria-label="Stop current process"
            >
              <Square className="w-3 h-3" />
            </button>
          </Tooltip>
          <Tooltip content="Clear terminal (Ctrl+L)" placement={tooltipPlacement}>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); sendInput('\x0c') }}
              className={buttonClass}
              aria-label="Clear terminal"
            >
              <Eraser className="w-3 h-3" />
            </button>
          </Tooltip>
          <SessionPersistenceMenu
            sessionId={sessionId}
            isAgent={isAgent}
            placement={tooltipPlacement === 'top' ? 'top' : 'bottom'}
          />
        </>
      )}
      {detach && (
        <Tooltip content={detachTitle(detach, detachWhere)} placement={tooltipPlacement}>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onToggleDetach() }}
            className={buttonClass}
            aria-label={detachTitle(detach, detachWhere)}
          >
            {detach === 'attach'
              ? <Minimize2 className="w-3 h-3" />
              : <ExternalLink className="w-3 h-3" />}
          </button>
        </Tooltip>
      )}
      {onToggleFullscreen && (
        <Tooltip
          content={fullscreen ? 'Restore view mode' : 'Focus pane full screen'}
          placement={tooltipPlacement}
        >
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onToggleFullscreen() }}
            className={buttonClass}
            aria-label={fullscreen ? 'Restore view mode' : 'Focus pane full screen'}
          >
            {fullscreen
              ? <Minimize2 className="w-3 h-3" />
              : <Maximize2 className="w-3 h-3" />}
          </button>
        </Tooltip>
      )}
    </span>
  )
}
