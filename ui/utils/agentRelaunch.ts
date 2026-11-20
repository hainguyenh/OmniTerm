import { findSessionByTabId } from './agentSessionStorage'
import { getPanePresence } from './agentPresenceStore'
import { formatAgentProfileCommand } from './agentRegistry'

/**
 * The command that starts the agent a pane runs, with the same profile, as a fresh conversation.
 * The stored session says which agent and profile first; a pane whose agent never wrote a session
 * file has none, but the live process tree still says. Null: the pane runs no known agent.
 */
export function agentRelaunchCommand(sessionId: string): string | null {
  const stored = findSessionByTabId(sessionId)
  if (stored) return formatAgentProfileCommand(stored.agent, stored.launcher, stored.profileName)
  const presence = getPanePresence(sessionId)
  return presence ? formatAgentProfileCommand(presence.agent, presence.launcher, presence.profileName) : null
}
