import { RotateCw, Sparkles, Unplug } from 'lucide-react'

import { FrozenSessionStatus } from '../features/agent-quota/paneHosts'
import { AttachmentsFooterButton } from '../components/AttachmentsFooterButton'
import MetricsChips from '../components/SessionMetricsChips'
import { useTabs } from '../ide/editor/core/controller'
import { usePanePresence } from '../utils/agentPresenceStore'

import { useSessionBridge } from './sessions/sessionBridge'
import { parseSessionInput } from './sessions/sessionInput'
import { useSessionLive } from './sessions/sessionLive'

const action = 'inline-flex items-center gap-1 px-1.5 rounded text-[11px] hover:bg-[var(--theme-hover-bg)]'

/**
 * Status bar widget that follows the active session tab: its agent's model, how a remote link is doing,
 * and reconnect/disconnect. Where it runs is the navigation bar's (`project › folder › shell`, see
 * `sessionPlaces`) and the branch the title bar's, as in IDEA; the widget shows nothing while the
 * active tab is not a session.
 */
export function StatusBarSessionWidget() {
  const sessionId = useTabs((state) => {
    const pane = state.panes[state.activePane]
    return parseSessionInput(pane?.tabs.find((tab) => tab.id === pane.active)?.input)
  })
  const session = useSessionBridge((state) => state.sessions.find((item) => item.id === sessionId))
  const api = useSessionBridge((state) => state.api)
  const live = useSessionLive()
  const presence = usePanePresence(sessionId)
  if (!sessionId || !session) return null
  const remote = session.connType !== 'LOCAL'
  const latency = session.connType === 'RDP' ? (live.latencies[sessionId] ?? null) : (live.metrics[sessionId]?.latency ?? null)
  const dead = session.status === 'closed' || session.status === 'error'
  return (
    <div className="inline-flex items-center gap-2 min-w-0" data-testid="status-bar-session" data-session={sessionId}>
      <FrozenSessionStatus sessionId={sessionId} />
      {presence?.modelInfo && (
        <span className="inline-flex items-center gap-1 font-mono" title={`AI Agent Model: ${presence.modelInfo.display}`}>
          <Sparkles className="w-3 h-3 text-theme-accent" />
          {presence.modelInfo.display}
        </span>
      )}
      {remote && (
        <MetricsChips status={session.status} latency={latency} metrics={live.metrics[sessionId]} connectedAt={live.connectedAt[sessionId]} compact />
      )}
      <AttachmentsFooterButton sessionId={sessionId} />
      {dead && api && (
        <button type="button" className={action} onClick={() => api.reconnect(sessionId)}>
          <RotateCw className="w-3 h-3" /> Reconnect
        </button>
      )}
      {remote && !dead && api && (
        <button type="button" className={action} onClick={() => api.killSession(sessionId)}>
          <Unplug className="w-3 h-3" /> Disconnect
        </button>
      )}
    </div>
  )
}
