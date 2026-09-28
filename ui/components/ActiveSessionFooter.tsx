import type { Connection, SessionStatus } from '@omniterm/contract'

import { dispatchTerminalSave } from '../utils/terminalCopyExtract'
import { SessionFooterBar } from './SessionFooterBar'
import type { SessionControlAppearance } from './SessionControlButtons'

interface ActiveSessionFooterProps {
  activeTabId?: string | null
  conn?: Connection
  footerWorkspaceTitle: string
  localLocationLabel: string
  shellLabel?: string
  statuses: Record<string, SessionStatus>
  latencies: Record<string, number | null>
  metrics: Record<string, SessionMetrics | undefined>
  connectedAt: Record<string, number | undefined>
  layoutMode: number
  activity: Record<string, boolean>
  appearance?: SessionControlAppearance
  onReconnect: (sessionId: string) => void
  onDisconnect: (sessionId: string) => void
}

/** Owns the active-session footer branch so the main shell stays focused on layout composition. */
export default function ActiveSessionFooter({
  activeTabId, conn, footerWorkspaceTitle, localLocationLabel, shellLabel, statuses, latencies,
  metrics, connectedAt, layoutMode, activity, appearance, onReconnect, onDisconnect,
}: ActiveSessionFooterProps) {
  if (!activeTabId) return null
  if (!conn) {
    return (
      <div className="relative z-30 order-last min-h-7 flex-shrink-0 bg-theme-sidebar border-t border-theme-border flex items-center gap-2 px-2.5 text-[10px] text-theme-dim">
        <span className="truncate">{footerWorkspaceTitle}</span>
        <span className="opacity-60">·</span>
        <span className="truncate">Editor active</span>
      </div>
    )
  }

  const status = statuses[activeTabId] ?? 'connecting'
  const resolvedLatency = conn.type === 'RDP' ? (latencies[activeTabId] ?? null) : (metrics[activeTabId]?.latency ?? null)
  const locationLabel = conn.type === 'LOCAL' ? localLocationLabel : `${conn.user}@${conn.host}:${conn.port}`
  return (
    <SessionFooterBar
      conn={conn}
      sessionId={activeTabId}
      status={status}
      latency={resolvedLatency}
      metrics={metrics[activeTabId]}
      connectedAt={connectedAt[activeTabId]}
      layoutMode={layoutMode}
      busy={conn.type === 'LOCAL' ? (activity[activeTabId] ?? false) : undefined}
      locationLabel={locationLabel}
      shellLabel={shellLabel}
      appearance={appearance}
      onSaveOutput={() => dispatchTerminalSave(activeTabId)}
      onReconnect={() => onReconnect(activeTabId)}
      onDisconnect={() => onDisconnect(activeTabId)}
    />
  )
}
