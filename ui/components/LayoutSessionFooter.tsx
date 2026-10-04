import type { Connection, SessionStatus } from '@omniterm/contract'

import ActiveSessionFooter from './ActiveSessionFooter'
import { SessionFooterBar } from './SessionFooterBar'
import type { SessionControlAppearance } from './SessionControlButtons'
import type { MainLayoutModel } from './useMainLayoutController'
import type { SessionTabItem } from './SessionTabs'
import { dispatchTerminalSave } from '../utils/terminalCopyExtract'
import { shellLabel as resolveShellLabel } from '../shellOptions'

interface LayoutSessionFooterProps {
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
  rawCwd?: string
  gitEnabled?: boolean
  onReconnect: (sessionId: string) => void
  onDisconnect: (sessionId: string) => void
}

export function PaneSessionFooter({
  tab, conn, model,
}: {
  tab: SessionTabItem
  conn?: Connection
  model: MainLayoutModel
}) {
  if (!conn || model.layoutMode > 4 || model.layoutMode <= 1) return null
  const { statuses, latencies, metrics, connectedAt, layoutMode, activity, resolveAppearance, reconnectSession, disconnectSession } = model
  const status = statuses[tab.id] ?? 'connecting'
  const latency = conn.type === 'RDP' ? (latencies[tab.id] ?? null) : (metrics[tab.id]?.latency ?? null)
  // The live cwd (OSC 7 / 9;9) when the shell reports one — the launch folder goes stale after `cd`.
  const liveCwd = model.sessionCwds?.[tab.id] ?? conn.localCwd
  const locationLabel = conn.type === 'LOCAL' ? (liveCwd ?? tab.name) : `${conn.user}@${conn.host}:${conn.port}`
  const shell = conn.type === 'LOCAL' ? resolveShellLabel(model.shellOptions ?? [], conn.shell) : undefined
  const appearance = resolveAppearance?.(tab.id, tab.connId)
  const gitEnabled = model.appSettings?.gitUtilEnabled ?? true

  return (
    <SessionFooterBar
      conn={conn}
      sessionId={tab.id}
      status={status}
      latency={latency}
      metrics={metrics[tab.id]}
      connectedAt={connectedAt[tab.id]}
      layoutMode={layoutMode}
      busy={conn.type === 'LOCAL' ? (activity[tab.id] ?? false) : undefined}
      locationLabel={locationLabel}
      shellLabel={shell}
      appearance={appearance}
      gitCwd={gitEnabled && conn.type === 'LOCAL' ? (liveCwd ?? undefined) : undefined}
      onSaveOutput={() => dispatchTerminalSave(tab.id)}
      onReconnect={() => reconnectSession(tab.id)}
      onDisconnect={() => disconnectSession(tab.id)}
    />
  )
}

export default function LayoutSessionFooter({
  activeTabId, conn, footerWorkspaceTitle, localLocationLabel, shellLabel, statuses, latencies,
  metrics, connectedAt, layoutMode, activity, appearance, rawCwd, gitEnabled = true, onReconnect, onDisconnect,
}: LayoutSessionFooterProps) {
  if (layoutMode > 1 && layoutMode <= 4) return null
  return (
    <>
      <ActiveSessionFooter
        activeTabId={activeTabId}
        conn={conn}
        footerWorkspaceTitle={footerWorkspaceTitle}
        localLocationLabel={localLocationLabel}
        shellLabel={shellLabel}
        statuses={statuses}
        latencies={latencies}
        metrics={metrics}
        connectedAt={connectedAt}
        layoutMode={layoutMode}
        activity={activity}
        appearance={appearance}
        rawCwd={rawCwd}
        gitEnabled={gitEnabled}
        onReconnect={onReconnect}
        onDisconnect={onDisconnect}
      />
      {!activeTabId && (
        <div className="relative z-30 order-last min-h-7 flex-shrink-0 bg-theme-sidebar border-t border-theme-border flex items-center gap-2 px-2.5 text-[10px] text-theme-dim">
          <span className="truncate">{footerWorkspaceTitle}</span>
          <span className="opacity-60">·</span>
          <span>No active terminal</span>
        </div>
      )}
    </>
  )
}
