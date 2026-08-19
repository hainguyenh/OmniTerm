import React from 'react'
import { Bot, Loader2, Monitor, RotateCw, Terminal, Unplug } from 'lucide-react'
import type { Connection, SessionStatus } from '@omniterm/contract'
import type { DetachAction } from '../detachControl'
import { activityLabel, STATUS_DOT, STATUS_LABEL, STATUS_TEXT } from '../tabVisuals'
import { paneIdentity } from '../paneIdentity'
import MetricsChips from './SessionMetricsChips'
import { extractFolder, parseAgentTitle } from '../utils/agentTitle'
import SessionControlButtons from './SessionControlButtons'
import { Tooltip } from './Tooltip'

/**
 * The bottom status-bar that appears while an active terminal session is open.
 * Rendered as `order-last` so an embedded RDP desktop can never paint over it.
 *
 * When the active LOCAL shell's OSC title reveals an AI agent, the left-hand
 * area switches from the plain connection name to:
 *   <Bot> {agent name} - {folder} // {shell}
 */
interface SessionFooterBarProps {
  conn: Connection
  sessionId: string
  tabName: string
  status: SessionStatus
  latency: number | null
  metrics: SessionMetrics | undefined
  connectedAt: number | undefined
  layoutMode: number
  focusedPane: number
  /** Whether the shell process is currently running something (LOCAL only). */
  busy: boolean | undefined
  workspaceTitle: string
  /** Human-readable shell label for LOCAL connections, or user@host:port for SSH. */
  footerShellLabel: string
  zoomFactor: number | undefined
  detach: DetachAction | null
  onToggleDetach: () => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  onReconnect: () => void
  onDisconnect: () => void
  onZoomReset: (() => void) | undefined
}

export const SessionFooterBar: React.FC<SessionFooterBarProps> = ({
  conn, sessionId, tabName, status, latency, metrics, connectedAt, layoutMode, focusedPane,
  busy, workspaceTitle, footerShellLabel, zoomFactor, detach, onToggleDetach, fullscreen,
  onToggleFullscreen, onReconnect, onDisconnect, onZoomReset,
}) => {
  // Derive agent context from the live tab name (kept in sync with OSC title by TerminalView),
  // with fallback to connection command/name.
  const agentCtx = conn.type === 'LOCAL'
    ? parseAgentTitle(tabName) || parseAgentTitle(conn.localCommand) || parseAgentTitle(conn.name)
    : null
  const fallbackFolder = conn.localCwd ? extractFolder(conn.localCwd) : null
  const displayFolder = agentCtx?.folderName || fallbackFolder
  const activityWord = activityLabel({ status, busy })

  // Pane identity chip — only shown in multi-pane layouts.
  const paneId = layoutMode > 1 ? paneIdentity(focusedPane) : null
  const PaneIcon = paneId?.icon ?? null

  return (
    <div className="relative z-30 order-last h-7 flex-shrink-0 bg-theme-sidebar border-t border-theme-border flex items-center gap-2 px-2.5 select-none">
      {paneId && PaneIcon && (
        <span className="flex items-center gap-1 flex-shrink-0" style={{ color: paneId.color }}
          title={`Pane ${focusedPane + 1} · ${paneId.label}`}>
          <PaneIcon className="w-3.5 h-3.5" fill={paneId.color} />
          <span className="text-[9px] font-bold">{focusedPane + 1}</span>
        </span>
      )}
      <span className="max-w-[180px] truncate text-[10px] text-theme-dim" title={workspaceTitle}>
        {workspaceTitle}
      </span>
      <span className="opacity-50">·</span>
      {/* Connection type icon — Bot when agent is active, else Terminal/Monitor */}
      {agentCtx
        ? <Bot className="w-3.5 h-3.5 text-theme-accent flex-shrink-0" />
        : conn.type === 'RDP'
          ? <Monitor className="w-3.5 h-3.5 text-theme-accent flex-shrink-0" />
          : <Terminal className="w-3.5 h-3.5 text-theme-accent flex-shrink-0" />
      }
      {/* Agent mode: "{Agent} - {Folder} // {shell}" replaces plain conn.name */}
      {agentCtx ? (
        <span className="text-xs font-medium text-theme-accent truncate min-w-0 flex items-baseline gap-1.5">
          <span className="truncate">
            {agentCtx.agentName}
            {displayFolder && <> - {displayFolder}</>}
          </span>
          <span className="text-[9px] text-theme-dim font-normal flex-shrink-0">
            // {footerShellLabel}
          </span>
        </span>
      ) : (
        <span className="text-xs font-medium text-[var(--theme-fg)] truncate min-w-0">{conn.name}</span>
      )}
      {/* Status pill — sits right after the name, with the shell's activity when we know it */}
      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0 rounded-full flex-shrink-0 ${STATUS_TEXT[status]} bg-theme-bg`}>
        {status === 'connecting' ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
        )}
        {STATUS_LABEL[status]}
        {activityWord && (
          <span className="font-normal text-theme-dim">· {activityWord}</span>
        )}
      </span>
      {/* Live metrics: latency (SSH + RDP) + remote CPU/RAM/disk + uptime (SSH). */}
      <MetricsChips
        status={status}
        latency={latency}
        metrics={metrics}
        connectedAt={connectedAt}
        compact={layoutMode > 1}
      />
      {/* In single-view without agent, show the shell/host on the right */}
      {layoutMode === 1 && !agentCtx && (
        <span className="text-[10px] text-theme-dim truncate min-w-0 ml-auto shrink">
          {footerShellLabel}
        </span>
      )}
      <div className={`flex items-center gap-1.5 ${layoutMode > 1 || (layoutMode === 1 && !agentCtx) ? '' : 'ml-auto'}`}>
        {status === 'closed' || status === 'error' ? (
          <Tooltip content="Reconnect to this session" placement="top">
            <button
              onClick={onReconnect}
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-theme-accent text-theme-accent-fg hover:bg-[#89ddff] transition-colors"
            >
              <RotateCw className="w-3 h-3" />
              Reconnect
            </button>
          </Tooltip>
        ) : (
          conn.type !== 'LOCAL' && (
            <Tooltip content="Disconnect from this session" placement="top">
              <button
                onClick={onDisconnect}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border border-theme-border text-theme-fg hover:border-[#f7768e] hover:text-theme-error transition-colors"
              >
                <Unplug className="w-3 h-3" />
                Disconnect
              </button>
            </Tooltip>
          )
        )}
      </div>
      {typeof zoomFactor === 'number' && (
        <Tooltip content="Reset zoom to 100%" shortcut="Ctrl+0" placement="top">
          <button
            type="button"
            onClick={onZoomReset}
            className="flex-shrink-0 text-[10px] font-mono text-theme-dim hover:text-theme-accent transition-colors px-1"
          >
            {Math.round(zoomFactor * 100)}%
          </button>
        </Tooltip>
      )}
      <SessionControlButtons
        conn={conn}
        sessionId={sessionId}
        busy={busy}
        isAgent={agentCtx !== null}
        detach={detach}
        onToggleDetach={onToggleDetach}
        fullscreen={fullscreen}
        onToggleFullscreen={onToggleFullscreen}
        tooltipPlacement="top"
        className="ml-auto"
      />
    </div>
  )
}
