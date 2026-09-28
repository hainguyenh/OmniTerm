/** Safe reboot recovery recipes for AI coding CLIs. Bare fresh-agent launches are intentionally absent. */
export interface AgentResumeRecipe {
  command: string
  resumeArgs: string[]
}

export const AGENT_REGISTRY: Record<string, AgentResumeRecipe | null> = {
  'OpenCode':        { command: 'opencode', resumeArgs: ['--continue'] },
  'Claude Code':     { command: 'claude', resumeArgs: ['--continue'] },
  'Antigravity CLI': { command: 'agy', resumeArgs: ['--continue'] },
  'Codex':           { command: 'codex', resumeArgs: ['resume', '--last'] },
  'Aider':           { command: 'aider', resumeArgs: ['--restore-chat-history'] },
  'Gemini CLI':      { command: 'gemini', resumeArgs: ['--resume'] },
  'Goose':           null,
  'Copilot CLI':     { command: 'copilot', resumeArgs: ['--continue'] },
}

export function getAgentResumeRecipe(agentName?: string | null): AgentResumeRecipe | null {
  if (!agentName) return null
  const normalized = agentName.trim().toLowerCase()
  if (!normalized) return null
  for (const [name, recipe] of Object.entries(AGENT_REGISTRY)) {
    if (name.toLowerCase() === normalized || recipe?.command.toLowerCase() === normalized) {
      return recipe
    }
  }
  return null
}

const SESSION_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|ses_[A-Za-z0-9_-]+)$/i
/** Matches the launcher naming rule for profile-specific commands. */
const LAUNCHER_RE = /^(claude|codex|opencode|agy)-[A-Za-z0-9_.]{1,40}$/

/**
 * Resolve an executable launcher name or CLI command from an explicit launcher or profile name.
 */
export function resolveAgentLauncher(
  agentName?: string | null,
  launcher?: string | null,
  profileName?: string | null,
): string | null {
  const recipe = getAgentResumeRecipe(agentName)
  const norm = (agentName || '').trim().toLowerCase()
  const agentPrefix = norm.includes('codex')
    ? 'codex'
    : norm.includes('opencode') || norm.includes('open code')
      ? 'opencode'
      : norm.includes('antigravity') || norm === 'agy'
        ? 'agy'
        : 'claude'

  const trimmedLauncher = launcher?.trim()
  if (trimmedLauncher) {
    if (trimmedLauncher === recipe?.command || LAUNCHER_RE.test(trimmedLauncher)) {
      return trimmedLauncher
    }
    return null
  }

  const trimmedProfile = profileName?.trim()
  if (trimmedProfile) {
    if (LAUNCHER_RE.test(trimmedProfile)) return trimmedProfile
    if (trimmedProfile !== 'claude' && trimmedProfile !== 'codex' && trimmedProfile !== 'opencode' && trimmedProfile !== 'agy') {
      const candidate = `${agentPrefix}-${trimmedProfile}`
      if (LAUNCHER_RE.test(candidate)) return candidate
    }
  }

  return recipe?.command ?? null
}

/** The command to start a fresh agent session using the detected profile (e.g. `claude-th` or `claude`). */
export function formatAgentProfileCommand(
  agentName?: string | null,
  launcher?: string | null,
  profileName?: string | null,
): string | null {
  return resolveAgentLauncher(agentName, launcher, profileName)
}

/**
 * A resume command with a session id becomes an executable shell string, so every piece that goes
 * into it is checked here even though callers are expected to have checked it already: a strict
 * UUID or session id, and a launcher that is either the recipe's own trusted command name or
 * shaped like a real profile launcher (`claude-th`, never a free-form string such as a shell label).
 */
export function formatAgentResumeCommand(
  agentName?: string | null,
  sessionId?: string | null,
  launcher?: string | null,
  profileName?: string | null,
): string | null {
  const recipe = getAgentResumeRecipe(agentName)

  if (sessionId && sessionId.trim() && sessionId.trim().toLowerCase() !== 'latest') {
    const sid = sessionId.trim()
    if (!SESSION_ID_RE.test(sid)) return null
    const baseCmd = resolveAgentLauncher(agentName, launcher, profileName)
    if (!baseCmd) return null
    const norm = (agentName || '').trim().toLowerCase()
    if (norm.includes('codex') || baseCmd.startsWith('codex')) {
      return `${baseCmd} resume ${sid}`
    }
    if (norm.includes('antigravity') || norm === 'agy' || baseCmd === 'agy') {
      return `${baseCmd} --conversation ${sid}`
    }
    if (norm.includes('opencode') || norm.includes('open code') || baseCmd.startsWith('opencode')) {
      return `${baseCmd} --session ${sid}`
    }
    return `${baseCmd} --resume ${sid}`
  }

  const baseCmd = resolveAgentLauncher(agentName, launcher, profileName) ?? recipe?.command
  return recipe && baseCmd ? [baseCmd, ...recipe.resumeArgs].join(' ') : null
}

/** How a pane handles an image on the clipboard when the user pastes. */
export type ImagePasteMode =
  /** Persist the image to a temp PNG and insert its absolute path — the agent attaches by path. */
  | 'insert-path'
  /** Leave the keystroke/paste untouched so the agent's own clipboard binding fires. */
  | 'forward'

/**
 * Agents verified to attach a pasted image from an inserted temp-file path. Anything not listed
 * here (unknown agents and plain shells must never see a stray path in their prompt) gets 'forward'.
 */
const PATH_PASTE_AGENTS = [
  'OpenCode',
  'Claude Code',
  'Antigravity CLI',
  'Codex',
  'Aider',
  'Cursor Agent',
  'Copilot CLI',
  'Continue',
  'Cline',
  'Goose',
  'Devin',
  'SWE-Agent',
  'Gemini CLI',
]

export function imagePasteModeFor(agentName?: string | null): ImagePasteMode {
  if (!agentName) return 'forward'
  const normalized = agentName.trim().toLowerCase()
  if (!normalized) return 'forward'
  const isAgent = PATH_PASTE_AGENTS.some(name => {
    const n = name.toLowerCase()
    return n === normalized || normalized.includes(n) || n.includes(normalized)
  }) || normalized === 'agy' || normalized === 'claude' || normalized === 'codex'
  return isAgent ? 'insert-path' : 'forward'
}

/**
 * Sticky agent detection: TUIs routinely overwrite their own terminal title with a bare cwd
 * mid-session, which would demote an already-detected agent to null ('forward') and silently
 * kill image pastes. Keep the first detection until another KNOWN agent takes over the title.
 */
export function latchAgent(current: string | null, next: string | null): string | null {
  return next ?? current
}
