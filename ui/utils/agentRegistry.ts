/** Safe reboot recovery recipes for AI coding CLIs. Bare fresh-agent launches are intentionally absent. */
export interface AgentResumeRecipe {
  command: string
  resumeArgs: string[]
}

export const AGENT_REGISTRY: Record<string, AgentResumeRecipe | null> = {
  'OpenCode':        { command: 'opencode', resumeArgs: ['--continue'] },
  'Claude Code':     { command: 'claude', resumeArgs: ['--continue'] },
  'Antigravity CLI': null,
  'Codex':           { command: 'codex', resumeArgs: ['resume', '--last'] },
  'Aider':           { command: 'aider', resumeArgs: ['--restore-chat-history'] },
  'Gemini CLI':      { command: 'gemini', resumeArgs: ['--resume'] },
  'Goose':           null,
  'Copilot CLI':     null,
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

export function formatAgentResumeCommand(agentName?: string | null): string | null {
  const recipe = getAgentResumeRecipe(agentName)
  return recipe ? [recipe.command, ...recipe.resumeArgs].join(' ') : null
}

/** How a pane handles an image on the clipboard when the user pastes. */
export type ImagePasteMode =
  /** Persist the image to a temp PNG and insert its absolute path — the agent attaches by path. */
  | 'insert-path'
  /** Leave the keystroke/paste untouched so the agent's own clipboard binding fires. */
  | 'forward'

/**
 * Agents verified to attach a pasted image from an inserted temp-file path. Anything not listed
 * here (Antigravity CLI reads the clipboard itself on Alt+V; unknown agents and plain shells
 * must never see a stray path in their prompt) gets 'forward'.
 */
const PATH_PASTE_AGENTS = ['OpenCode', 'Claude Code', 'Gemini CLI']

export function imagePasteModeFor(agentName?: string | null): ImagePasteMode {
  if (!agentName) return 'forward'
  const normalized = agentName.trim().toLowerCase()
  if (!normalized) return 'forward'
  return PATH_PASTE_AGENTS.some(name => name.toLowerCase() === normalized)
    ? 'insert-path'
    : 'forward'
}
