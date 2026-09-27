/**
 * Which AI agent (if any) runs under each local pane, and its resumable Claude session id.
 *
 * This does not scan terminal output. `agent_quota_detect` walks each pane's own process tree and
 * reads the agent's own profile-directory environment variable (or its default), so the answer is
 * exact instead of guessed from a title or a printed UUID — see `crates/…/agent_session.rs` for why
 * that guessing was unsafe. Only Claude sessions resolve to an id in this pass; Codex is detected
 * but not yet resumable (see AGENTS.md plan notes), and anything else is not tracked at all.
 */
const SESSION_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|ses_[A-Za-z0-9_-]+|latest)$/i
/** Matches the launcher naming rule for profile-specific commands. */
const LAUNCHER_RE = /^(claude|codex|opencode|agy)-[A-Za-z0-9_.]{1,40}$/

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

export function isValidLauncher(value: unknown): value is string {
  return typeof value === 'string' && LAUNCHER_RE.test(value)
}

/** One pane's detected agent, as reported by `agent_quota_detect` (camelCase over IPC). */
export interface DetectedPaneAgent {
  sessionId: string
  agent: 'claude' | 'codex' | 'agy' | 'opencode'
  pid: number
  startTime: number
  profileDir?: string
  profileName: string
  launcher?: string
  subAgentCount: number
}

/** All local panes' detected agents in one call — one process-table scan for every pane at once. */
export async function detectPaneAgents(): Promise<DetectedPaneAgent[]> {
  const api = window.omnitermAPI
  if (!api?.agentSessions?.detect) return []
  try {
    const detected = await api.agentSessions.detect()
    return Array.isArray(detected) ? detected : []
  } catch {
    return []
  }
}

/**
 * The Claude session file for one pane, resolved on disk from the agent's own profile directory —
 * never from a renderer-supplied profile guess. Returns null when the agent isn't Claude, has no
 * profile directory, or has no matching session file yet.
 */
export async function resolveClaudeSessionId(agent: DetectedPaneAgent, cwd: string | undefined): Promise<string | null> {
  const api = window.omnitermAPI
  if (agent.agent !== 'claude' || !agent.profileDir || !cwd || !api?.agentSessions?.resolveClaudeSession) {
    return null
  }
  try {
    const sessionId = await api.agentSessions.resolveClaudeSession(agent.profileDir, cwd, agent.startTime)
    return isValidSessionId(sessionId) ? sessionId : null
  } catch {
    return null
  }
}
