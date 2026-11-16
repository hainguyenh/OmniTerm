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
}

export const QUICK_START_AGENTS: readonly QuickStartAgent[] = [
  { id: 'claude', label: 'Claude', command: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'gemini', label: 'Gemini', command: 'gemini' },
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
      const key = folder.path.replace(/[/\\]+$/, '').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      projects.push({ key, label: lastSegment(folder.path), cwd: folder.path, workspaceId: workspace.id })
    }
  }
  return projects
}
