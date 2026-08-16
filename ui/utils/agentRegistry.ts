/**
 * agentRegistry.ts — registry of AI coding agent CLI profiles and resume recipes.
 *
 * Every agent here resumes by working directory (the session snapshot restores the tab's
 * `localCwd` alongside the command), so no per-agent session-id plumbing is needed.
 */

export interface AgentResumeRecipe {
  /** CLI executable name. */
  command: string
  /** Arguments appended after the command to resume a previous session. */
  resumeArgs: string[]
}

/**
 * Maps display name → resume recipe. Keys are the canonical agent display names used by
 * `parseAgentTitle` (ui/utils/agentTitle.ts). Agents that the title parser knows but that have
 * no entry here are detected in the UI but not resumable — they restore as a plain shell.
 */
export const AGENT_REGISTRY: Record<string, AgentResumeRecipe> = {
  'OpenCode':       { command: 'opencode', resumeArgs: [] },
  'Claude Code':    { command: 'claude',   resumeArgs: ['--resume'] },
  'Antigravity CLI':{ command: 'agy',      resumeArgs: [] },
  'Codex':          { command: 'codex',    resumeArgs: ['resume'] },
  'Aider':          { command: 'aider',    resumeArgs: ['--restore-chat-history'] },
  'Gemini CLI':     { command: 'gemini',   resumeArgs: [] },
  'Goose':          { command: 'goose',    resumeArgs: ['session', 'resume'] },
  'Copilot CLI':    { command: 'copilot',  resumeArgs: [] },
}

export function getAgentResumeRecipe(agentName?: string | null): AgentResumeRecipe | null {
  if (!agentName) return null
  const normalized = agentName.trim().toLowerCase()
  for (const [name, recipe] of Object.entries(AGENT_REGISTRY)) {
    if (name.toLowerCase() === normalized || recipe.command.toLowerCase() === normalized) {
      return recipe
    }
  }
  return null
}

export function formatAgentResumeCommand(agentName?: string | null): string | null {
  const recipe = getAgentResumeRecipe(agentName)
  if (!recipe) return null
  return [recipe.command, ...recipe.resumeArgs].join(' ')
}
