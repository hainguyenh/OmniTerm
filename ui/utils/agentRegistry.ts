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
