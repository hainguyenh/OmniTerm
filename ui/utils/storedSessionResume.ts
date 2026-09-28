/** Turning a stored agent session back into a running pane — shared by every resume entry point. */
import { formatAgentResumeCommand } from './agentRegistry'
import { isBookmarked, removeStoredSession, type StoredAgentSession } from './agentSessionStorage'

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  agy: 'Antigravity CLI',
  copilot: 'Copilot CLI',
  gemini: 'Gemini CLI',
}

/**
 * Recreate the CLI resume command for any stored session (Claude, Codex, Antigravity, OpenCode).
 */
export function resumeCommandFor(session: StoredAgentSession): string | null {
  const displayName = AGENT_DISPLAY_NAMES[session.agent] ?? 'Claude Code'
  const launcher = session.launcher === 'agy-gemini' ? undefined : session.launcher
  const profileName = session.profileName === 'agy-gemini' || (session.agent === 'agy' && session.profileName === 'gemini')
    ? undefined
    : session.profileName
  return formatAgentResumeCommand(displayName, session.sessionId, launcher, profileName)
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
