/** Turning a stored agent session back into a running pane — shared by every resume entry point. */
import { formatAgentResumeCommand } from './agentRegistry'
import { isBookmarked, removeStoredSession, type StoredAgentSession } from './agentSessionStorage'

/**
 * `claude-work --resume <id>`: the launcher (or profile) is always passed, so a session is resumed
 * in the profile that owns its session file rather than the default `~/.claude`.
 */
export function resumeCommandFor(session: StoredAgentSession): string | null {
  return formatAgentResumeCommand('Claude Code', session.sessionId, session.launcher, session.profileName)
}

/**
 * Called when the user resumes a session. A plain interrupted entry has done its job and goes; a
 * bookmark stays, and the resumed pane re-binds to it as soon as the pane poll sees the agent.
 */
export function consumeForResume(session: StoredAgentSession): void {
  if (!isBookmarked(session)) removeStoredSession(session.id)
}

/** Last path segment of a session's folder, for compact labels. */
export function sessionFolderName(session: Pick<StoredAgentSession, 'folderName' | 'cwd'>): string {
  return session.folderName || session.cwd?.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace'
}

export function formatTimeAgo(timestamp: number, now = Date.now()): string {
  const diffSec = Math.floor((now - timestamp) / 1000)
  if (diffSec < 60) return 'Just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  return `${Math.floor(diffHour / 24)}d ago`
}
