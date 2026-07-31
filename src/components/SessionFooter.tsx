import React from 'react'
import { Loader2, Monitor, Terminal, RotateCw, Unplug } from 'lucide-react'
import MetricsChips from './SessionMetricsChips'
import { activityLabel, STATUS_DOT, STATUS_LABEL, STATUS_TEXT } from '../tabVisuals'
import { paneIdentity } from '../paneIdentity'
import { shellLabel, type ShellOption } from '../shellOptions'
import type { Connection, SessionStatus } from '@omniterm/contract'

interface SessionFooterProps {
  activeTabId: string | null
  activeTabs: { id: string; connId: string; name: string }[]
  connById: (id?: string) => Connection | undefined
  statuses: Record<string, SessionStatus>
  latencies: Record<string, number | null>
  metrics: Record<string, SessionMetrics>
  connectedAt: Record<string, number>
  activity: Record<string, boolean>
  layoutMode: number
  focusedPane: number
  shellOptions: ShellOption[]
  reconnectSession: (id: string) => void
  disconnectSession: (id: string) => void
  zoomFactor?: number
  onZoomReset?: () => void
}

/**
 * The active-session control bar — rendered as a FOOTER (order-last) so the embedded RDP desktop
 * filling the content area can never cover the controls. Empty without a session: per-terminal
 * appearance lives on the TitleBar / pane headers now.
 */
const SessionFooter: React.FC<SessionFooterProps> = ({
  activeTabId, activeTabs, connById, statuses, latencies, metrics, connectedAt, activity,
  layoutMode, focusedPane, shellOptions, reconnectSession, disconnectSession, zoomFactor, onZoomReset,
}) => {
  return (
    <div className="order-last h-7 flex-shrink-0 bg-theme-sidebar border-t border-theme-border flex items-center gap-2 px-2.5 select-none">
      {activeTabId && (() => {
        const activeConnId = activeTabs.find(t => t.id === activeTabId)!.connId
        const conn = connById(activeConnId)
        // Transient (the connection list arrives just after the session starts): nothing to show yet.
        if (!conn) return null
        const status = statuses[activeTabId] ?? 'connecting'
        // Latency source differs by type: RDP has its own TCP probe; SSH carries it in metrics.
        const resolvedLatency = conn.type === 'RDP'
          ? (latencies[activeTabId] ?? null)
          : (metrics[activeTabId]?.latency ?? null)
        return (
          <>
            {/* Which pane the footer is describing, in that pane's own shape + hue. */}
            {layoutMode > 1 && (() => {
              const identity = paneIdentity(focusedPane)
              const Shape = identity.icon
              return (
                <span className="flex items-center gap-1 flex-shrink-0" style={{ color: identity.color }}
                  title={`Pane ${focusedPane + 1} · ${identity.label}`}>
                  <Shape className="w-3.5 h-3.5" fill={identity.color} />
                  <span className="text-[9px] font-bold">{focusedPane + 1}</span>
                </span>
              )
            })()}
            {conn.type === 'RDP'
              ? <Monitor className="w-3.5 h-3.5 text-theme-accent flex-shrink-0" />
              : <Terminal className="w-3.5 h-3.5 text-theme-accent flex-shrink-0" />
            }
            <span className="text-xs font-medium text-[var(--theme-fg)] truncate min-w-0">{conn.name}</span>

            {/* Status pill — sits right after the name, with the shell's activity when we know it */}
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0 rounded-full flex-shrink-0 ${STATUS_TEXT[status]} bg-theme-bg`}>
              {status === 'connecting' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
              )}
              {STATUS_LABEL[status]}
              {(() => {
                const word = activityLabel({
                  status,
                  busy: conn.type === 'LOCAL' ? (activity[activeTabId] ?? false) : undefined,
                })
                return word ? <span className="font-normal text-theme-dim">· {word}</span> : null
              })()}
            </span>

            {/* Live metrics: latency (SSH + RDP) + remote CPU/RAM/disk + uptime (SSH). */}
            <MetricsChips
              status={status}
              latency={resolvedLatency}
              metrics={metrics[activeTabId]}
              connectedAt={connectedAt[activeTabId]}
              compact={layoutMode > 1}
            />

            {layoutMode === 1 && (
              <span className="text-[10px] text-theme-dim truncate min-w-0 ml-auto shrink">
                {conn.type === 'LOCAL'
                  ? shellLabel(shellOptions, conn.shell)
                  : `${conn.user}@${conn.host}:${conn.port}`}
              </span>
            )}

            <div className={`flex items-center gap-1.5 ${layoutMode > 1 ? 'ml-auto' : ''}`}>
              {status === 'closed' || status === 'error' ? (
                <button
                  onClick={() => reconnectSession(activeTabId)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-theme-accent text-theme-accent-fg hover:bg-[#89ddff] transition-colors"
                >
                  <RotateCw className="w-3 h-3" />
                  Reconnect
                </button>
              ) : (
                conn.type !== 'LOCAL' && (
                  <button
                    onClick={() => disconnectSession(activeTabId)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border border-theme-border text-theme-fg hover:border-[#f7768e] hover:text-theme-error transition-colors"
                  >
                    <Unplug className="w-3 h-3" />
                    Disconnect
                  </button>
                )
              )}
            </div>
          </>
        )
      })()}
      {/* Zoom level — click to reset to 100% (same as Ctrl+0). Always visible, even idle. */}
      {typeof zoomFactor === 'number' && (
        <button
          type="button"
          onClick={onZoomReset}
          title="Reset zoom to 100%"
          className="ml-auto flex-shrink-0 text-[10px] font-mono text-theme-dim hover:text-theme-accent transition-colors px-1"
        >
          {Math.round(zoomFactor * 100)}%
        </button>
      )}
    </div>
  )
}

export default SessionFooter
