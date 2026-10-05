import type React from 'react'
import { RotateCw, Sparkles, Unplug } from 'lucide-react'
import type { Connection, SessionStatus } from '@omniterm/contract'
import { FrozenSessionStatus } from '../../plugins/agent-quota/app/paneHosts'
import { usePanePresence } from '../utils/agentPresenceStore'
import { AttachmentsFooterButton } from './AttachmentsFooterButton'
import { GitBranchFooter } from './git/GitBranchFooter'
import SessionControlButtons, { type SessionControlAppearance } from './SessionControlButtons'
import MetricsChips from './SessionMetricsChips'
import { Tooltip } from './Tooltip'

interface SessionFooterBarProps {
  conn: Connection
  sessionId: string
  status: SessionStatus
  latency: number | null
  metrics: SessionMetrics | undefined
  connectedAt: number | undefined
  layoutMode: number
  busy: boolean | undefined
  locationLabel: string
  shellLabel?: string
  appearance?: SessionControlAppearance
  gitCwd?: string
  onSaveOutput: () => void
  onReconnect: () => void
  onDisconnect: () => void
}

/**
 * The connection-level strip under a terminal: where it runs (folder or host, shell), how the link
 * is doing (metrics), what the pane attached (images and files, for agent panes) and the user's
 * chosen footer actions. Identity, status, the work item and the bookmark belong to the pane header
 * above, so none of it is repeated here.
 */
export const SessionFooterBar: React.FC<SessionFooterBarProps> = ({
  conn, sessionId, status, latency, metrics, connectedAt, layoutMode, busy, locationLabel,
  shellLabel, appearance, gitCwd, onSaveOutput, onReconnect, onDisconnect,
}) => {
  const presence = usePanePresence(sessionId)
  return (
    <div data-session-footer className="relative z-30 order-last h-7 flex-shrink-0 bg-theme-sidebar border-t border-theme-border flex items-center gap-2 px-2.5 select-none">
      <FrozenSessionStatus sessionId={sessionId} />
      <span className="min-w-0 flex-1 flex items-center gap-1 overflow-hidden text-[10px] text-theme-dim" title={locationLabel} aria-label={`${conn.type === 'LOCAL' ? 'Working folder' : 'Remote host'}: ${locationLabel}`}>
        <span className="truncate">{locationLabel}</span>
        {shellLabel && <span className="flex-shrink-0 text-theme-dim/70">// {shellLabel}</span>}
      </span>
      {presence?.modelInfo && (
        <span
          data-testid="session-agent-model"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-theme-dim hover:text-theme-fg hover:bg-theme-bg/60 transition-colors font-mono text-[10px] cursor-default flex-shrink-0"
          title={`AI Agent Model: ${presence.modelInfo.display}`}
        >
          <Sparkles className="w-3 h-3 text-theme-accent" />
          <span className="font-semibold text-theme-fg">{presence.modelInfo.display}</span>
        </span>
      )}
      {gitCwd && <GitBranchFooter cwd={gitCwd} />}
      <MetricsChips status={status} latency={latency} metrics={metrics} connectedAt={connectedAt} compact={layoutMode > 1} />
      <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
        <AttachmentsFooterButton sessionId={sessionId} />
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
