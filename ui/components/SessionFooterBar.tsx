import React, { useSyncExternalStore } from 'react'
import { Bot, Image as ImageIcon, Loader2, Monitor, RotateCw, Terminal, Unplug } from 'lucide-react'
import type { Connection, SessionStatus } from '@omniterm/contract'
import { formatTerminalTitle } from '../utils/agentTitle'
import { activityLabel, STATUS_DOT, STATUS_LABEL, STATUS_TEXT } from '../tabVisuals'
import { FrozenSessionStatus } from '../../plugins/agent-quota/app/paneHosts'
import { getLastPastedImage, requestOpen, subscribePastedImage } from '../utils/pastedImageStore'
import SessionControlButtons, { type SessionControlAppearance } from './SessionControlButtons'
import MetricsChips from './SessionMetricsChips'
import { Tooltip } from './Tooltip'

interface SessionFooterBarProps {
  conn: Connection
  sessionId: string
  tabName?: string
  isAgent?: boolean
  status: SessionStatus
  latency: number | null
  metrics: SessionMetrics | undefined
  connectedAt: number | undefined
  layoutMode: number
  busy: boolean | undefined
  locationLabel: string
  shellLabel?: string
  /** Kept for compatibility with custom-art callers; header activity owns the converted assets. */
  loadingArtUrl?: string | null
  appearance?: SessionControlAppearance
  onSaveOutput: () => void
  onReconnect: () => void
  onDisconnect: () => void
}

export const SessionFooterBar: React.FC<SessionFooterBarProps> = ({
  conn, sessionId, tabName, isAgent, status, latency, metrics, connectedAt, layoutMode, busy, locationLabel,
  shellLabel, appearance, onSaveOutput, onReconnect, onDisconnect,
}) => {
  const isAgentSession = isAgent ?? (tabName ? formatTerminalTitle(tabName, shellLabel, conn.name, conn.localCwd).isAgent : false)
  const TerminalIcon = isAgentSession ? Bot : conn.type === 'RDP' ? Monitor : Terminal
  const activityWord = activityLabel({ status, busy })
  const pastedImage = useSyncExternalStore(
    (cb) => subscribePastedImage(sessionId, cb),
    () => getLastPastedImage(sessionId),
  )
  return (
    <div data-session-footer className="relative z-30 order-last h-7 flex-shrink-0 bg-theme-sidebar border-t border-theme-border flex items-center gap-2 px-2.5 select-none">
      <span className="flex items-center gap-1.5 flex-shrink-0">
        <TerminalIcon className={`w-3.5 h-3.5 ${isAgentSession ? 'text-theme-accent' : 'text-theme-dim'}`} />
        <span className={`inline-flex min-w-0 items-center gap-1 text-xs font-semibold px-1.5 py-0 rounded-full flex-shrink-0 ${STATUS_TEXT[status]} bg-theme-bg`}>
          {status === 'connecting' ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />}
          {STATUS_LABEL[status]}
          {activityWord && <span className="font-normal text-theme-dim">· {activityWord}</span>}
        </span>
      </span>
      <FrozenSessionStatus sessionId={sessionId} />
      <span className="min-w-0 flex-1 flex items-center gap-1 overflow-hidden text-[10px] text-theme-dim" title={locationLabel} aria-label={`${conn.type === 'LOCAL' ? 'Working folder' : 'Remote host'}: ${locationLabel}`}>
        <span className="truncate">{locationLabel}</span>
        {shellLabel && <span className="flex-shrink-0 text-theme-dim/70">// {shellLabel}</span>}
      </span>
      <MetricsChips status={status} latency={latency} metrics={metrics} connectedAt={connectedAt} compact={layoutMode > 1} />
      <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
        {status === 'closed' || status === 'error' ? (
          <Tooltip content="Reconnect to this session" placement="top">
            <button type="button" onClick={onReconnect} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-theme-accent text-theme-accent-fg hover:bg-[#89ddff] transition-colors">
              <RotateCw className="w-3 h-3" /> Reconnect
            </button>
          </Tooltip>
        ) : (
          conn.type !== 'LOCAL' && (
            <Tooltip content="Disconnect from this session" placement="top">
              <button type="button" onClick={onDisconnect} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border border-theme-border text-theme-fg hover:border-[#f7768e] hover:text-theme-error transition-colors">
                <Unplug className="w-3 h-3" /> Disconnect
              </button>
            </Tooltip>
          )
        )}
        {pastedImage && (
          <Tooltip content="View last pasted image" placement="top">
            <button
              type="button"
              onClick={() => requestOpen(sessionId)}
              className="inline-flex items-center justify-center w-5 h-5 rounded text-theme-dim hover:bg-theme-bg hover:text-theme-accent transition-colors"
              aria-label="View last pasted image"
            >
              <ImageIcon className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
        <SessionControlButtons
          conn={conn}
          sessionId={sessionId}
          busy={busy}
          sessionLive={status === 'connected'}
          detach={null}
          onToggleDetach={() => {}}
          appearance={appearance}
          onSaveOutput={onSaveOutput}
          surface="footer"
          tooltipPlacement="top"
          className="flex-none"
        />
      </div>
    </div>
  )
}
