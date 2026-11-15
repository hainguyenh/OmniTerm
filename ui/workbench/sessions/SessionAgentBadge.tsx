import { agentBrandFor } from '../../utils/agentIdentity'
import { usePanePresence } from '../../utils/agentPresenceStore'

/** The small "agent" pill a session tab carries while an AI agent runs in it. */
export function SessionAgentBadge({ sessionId }: { sessionId: string }) {
  const presence = usePanePresence(sessionId)
  if (!agentBrandFor(presence?.agent)) return null
  return (
    <span
      data-session-agent-badge=""
      style={{
        fontSize: 10,
        lineHeight: '14px',
        padding: '0 5px',
        borderRadius: 8,
        // The agent pill (`.tab .badge`): purple in every theme.
        background: '#7c4dff33',
        color: '#b39dff',
      }}
    >
      agent
    </span>
  )
}
