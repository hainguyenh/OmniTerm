import type { DiscoveredProfile } from '../features/agent-quota/usage/types'

import type { Workspace } from '../domain'

export interface QuickStartProject {
  key: string
  label: string
  cwd: string
  workspaceId: string
}

export interface QuickStartAgent {
  id: string
  label: string
  /** Shell command that starts the agent; null opens a plain terminal. */
  command: string | null
  /** Icon name when it is not `agent-<id>`. */
  icon?: string
}

export const QUICK_START_AGENTS: readonly QuickStartAgent[] = [
  { id: 'claude', label: 'Claude', command: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'agy', label: 'Antigravity', command: 'agy' },
  { id: 'opencode', label: 'opencode', command: 'opencode' },
  { id: 'terminal', label: 'Terminal', command: null },
]

const lastSegment = (path: string): string => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path

/** Every project folder of every workspace, so a session can start in any of them. */
export function quickStartProjects(workspaces: readonly Workspace[]): QuickStartProject[] {
  const projects: QuickStartProject[] = []
  const seen = new Set<string>()
  for (const workspace of workspaces) {
    for (const folder of workspace.folders) {
      if (folder.disabled) continue
      const key = folder.path.replace(/[/\\]+$/, '').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      projects.push({ key, label: lastSegment(folder.path), cwd: folder.path, workspaceId: workspace.id })
    }
  }
  return projects
}

/**
 * The projects a session picker offers: those of workspace `workspaceId`, else every workspace's.
 * Listed per workspace first: a folder two workspaces share belongs to both, and the full list
 * keeps it only under the first one.
 */
export function workspaceQuickStartProjects(
  workspaces: readonly Workspace[],
  workspaceId: string | null | undefined,
): QuickStartProject[] {
  const own = quickStartProjects(workspaces.filter(workspace => workspace.id === workspaceId))
  return own.length ? own : quickStartProjects(workspaces)
}

/** One way to start Claude: the default profile, or a profile launcher (`claude-work`). */
export interface ClaudeProfileChoice {
  /** Shown to the user: the profile's name. */
  label: string
  /** Shell command that starts Claude in this profile: `claude`, or the launcher's bare name. */
  command: string
}

export const DEFAULT_CLAUDE_CHOICE: ClaudeProfileChoice = { label: 'claude (default)', command: 'claude' }

/**
 * The Claude profiles a session can start with, the default first. Only launchers are offered besides
 * the default: a profile that is just a directory has no command that selects it in every shell.
 * Without a scan result the default alone is returned, so Claude always starts.
 */
export function claudeProfileChoices(profiles: readonly DiscoveredProfile[]): ClaudeProfileChoice[] {
  const named = new Map<string, ClaudeProfileChoice>()
  for (const profile of profiles) {
    if (profile.agent !== 'claude' || !profile.launcher) continue
    const key = profile.launcher.toLowerCase()
    if (!named.has(key)) named.set(key, { label: profile.profileName, command: profile.launcher })
  }
  const rest = [...named.values()].sort((a, b) => a.label.localeCompare(b.label))
  return [DEFAULT_CLAUDE_CHOICE, ...rest]
}
