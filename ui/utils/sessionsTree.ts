import type { Connection, Workspace, WorkspaceFolder } from '../domain'

import type { StoredAgentSession } from './agentSessionStorage'
import { workspaceForConnection } from './workspaceIdentity'

export type SessionsFilter = 'all' | 'terminals' | 'agents' | 'resume'

export interface SessionsTreeTab {
  id: string
  connId: string
  name: string
}

export interface SessionNode {
  id: string
  name: string
  kind: 'terminal' | 'agent'
  /** Agent brand when `kind` is `agent`. */
  agent?: string
  /** Set for a session that is not open: it was cut off (`interrupted`) or kept by the user (`saved`). */
  stored?: { id: string; state: 'interrupted' | 'saved'; bookmarked: boolean }
}

export interface SessionGroup {
  key: string
  /** Project or folder the sessions belong to; duplicates are numbered ("OmniTerm (2)"). */
  label: string
  /** The local folder the group stands for, when it is one: new sessions can start there. */
  cwd?: string
  sessions: SessionNode[]
}

/** The project groups of one workspace, or of the sessions outside every workspace. */
export interface SessionSection {
  key: string
  label: string
  /** Null for the sessions that belong to no workspace. */
  workspaceId: string | null
  groups: SessionGroup[]
}

export interface SessionsTreeInput {
  tabs: readonly SessionsTreeTab[]
  workspaces: readonly Workspace[]
  connById: (id: string) => Connection | undefined
  /** Sessions that are editor files rather than terminals are left out. */
  isEditor: (tabId: string) => boolean
  cwdOf: (tabId: string) => string | undefined
  agentOf: (tabId: string) => string | undefined
  filter: SessionsFilter
  /** Agent sessions remembered by the app; only the ones without an open tab are listed. */
  stored?: readonly StoredAgentSession[]
  /**
   * The workspace the tree shows: only its sessions, by project, with every project of it listed
   * under the "All" filter even without sessions. Null shows every workspace, one section each,
   * then the sessions that belong to no workspace.
   */
  scopeWorkspaceId: string | null
}

interface Project {
  key: string
  label: string
  cwd?: string
}

interface Placement {
  workspace: Workspace | null
  project: Project
}

export const NO_WORKSPACE_SECTION = 'section:none'

const lastSegment = (path: string): string => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path
const normalized = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

const folderProject = (folder: WorkspaceFolder): Project => ({
  key: `dir:${normalized(folder.path)}`,
  label: folder.name?.trim() || lastSegment(folder.path),
  cwd: folder.path,
})

/** The workspace project folder `cwd` lies in (the innermost one across every workspace). */
function folderOf(cwd: string | undefined, workspaces: readonly Workspace[]): Placement | null {
  if (!cwd) return null
  const dir = normalized(cwd)
  let found: { workspace: Workspace; folder: WorkspaceFolder; length: number } | null = null
  for (const workspace of workspaces) {
    for (const folder of workspace.folders ?? []) {
      const root = normalized(folder.path)
      const inside = dir === root || dir.startsWith(`${root}/`)
      if (inside && (!found || root.length > found.length)) found = { workspace, folder, length: root.length }
    }
  }
  return found ? { workspace: found.workspace, project: folderProject(found.folder) } : null
}

/**
 * Where an open session belongs: the workspace project folder it runs in, else its connection's
 * workspace with the folder it runs in (or, for a remote connection, the connection) as project.
 */
function placeTab(tab: SessionsTreeTab, input: SessionsTreeInput): Placement {
  const conn = input.connById(tab.connId)
  const cwd = input.cwdOf(tab.id) ?? conn?.localCwd
  const inFolder = folderOf(cwd, input.workspaces)
  if (inFolder) return inFolder
  const workspace = workspaceForConnection([...input.workspaces], conn) ?? null
  if (cwd) return { workspace, project: { key: `dir:${normalized(cwd)}`, label: lastSegment(cwd), ...(conn?.type === 'LOCAL' ? { cwd } : {}) } }
  return { workspace, project: { key: `conn:${tab.connId}`, label: conn?.name || tab.name } }
}

/** Where a remembered session belongs; it only knows its folder. */
function placeStored(session: StoredAgentSession, input: SessionsTreeInput): Placement {
  const inFolder = folderOf(session.cwd, input.workspaces)
  if (inFolder) return inFolder
  if (session.cwd) return { workspace: null, project: { key: `dir:${normalized(session.cwd)}`, label: lastSegment(session.cwd), cwd: session.cwd } }
  return { workspace: null, project: { key: `stored:${session.id}`, label: session.folderName ?? 'Workspace' } }
}

function isResumable(session: StoredAgentSession): boolean {
  return session.state === 'interrupted' || session.state === 'saved'
}

/**
 * Number of remembered sessions the tree lists, waiting to be resumed or discarded. Counted from
 * the tree, so the Resume chip never counts a session of another workspace the scoped tree hides.
 */
export function storedSessionCount(sections: readonly SessionSection[]): number {
  let count = 0
  for (const section of sections) {
    for (const group of section.groups) count += group.sessions.filter((node) => node.stored).length
  }
  return count
}

/** Two different projects can share a folder name; number them so rows stay distinguishable. */
function numbered(groups: readonly SessionGroup[]): SessionGroup[] {
  const seen = new Map<string, number>()
  return groups.map((group) => {
    const count = (seen.get(group.label) ?? 0) + 1
    seen.set(group.label, count)
    return count === 1 ? group : { ...group, label: `${group.label} (${count})` }
  })
}

/**
 * Groups open terminal and agent sessions by workspace and project, in first-seen order, applying
 * the filter chip. Interrupted and bookmarked agent sessions without an open tab follow the open
 * ones. Empty groups are dropped, except the scoped workspace's own projects under "All"; with every
 * workspace shown, a workspace without sessions is dropped too.
 */
export function buildSessionsTree(input: SessionsTreeInput): SessionSection[] {
  const scoped = input.scopeWorkspaceId === null ? null : input.workspaces.find((w) => w.id === input.scopeWorkspaceId) ?? null
  const shown = scoped ? [scoped] : input.workspaces
  const sections = new Map<string, Map<string, SessionGroup>>()
  const sectionKey = (workspace: Workspace | null) => (workspace ? `section:${workspace.id}` : NO_WORKSPACE_SECTION)
  for (const workspace of shown) sections.set(sectionKey(workspace), new Map())
  if (!scoped) sections.set(NO_WORKSPACE_SECTION, new Map())

  const seeded = new Set<string>()
  if (scoped && input.filter === 'all') {
    const groups = sections.get(sectionKey(scoped))
    for (const folder of scoped.folders ?? []) {
      // A project switched off for now is not listed empty; its running sessions still show.
      if (folder.disabled) continue
      const project = folderProject(folder)
      seeded.add(project.key)
      groups?.set(project.key, { ...project, sessions: [] })
    }
  }

  const add = (placement: Placement, node: SessionNode) => {
    // A session outside the scoped workspace has no section and is not listed. A running AI agent
    // that belongs to no workspace at all (its project was removed, or it runs outside every project)
    // still shows under the scoped workspace instead of vanishing while it runs.
    const groups = sections.get(sectionKey(placement.workspace))
      ?? (placement.workspace === null && node.kind === 'agent' && scoped ? sections.get(sectionKey(scoped)) : undefined)
    if (!groups) return
    const group = groups.get(placement.project.key) ?? { ...placement.project, sessions: [] }
    groups.set(placement.project.key, group)
    group.sessions.push(node)
  }

  for (const tab of input.tabs) {
    if (input.isEditor(tab.id) || input.filter === 'resume') continue
    const agent = input.agentOf(tab.id)
    const kind = agent ? 'agent' : 'terminal'
    if (input.filter === 'agents' && kind !== 'agent') continue
    if (input.filter === 'terminals' && kind !== 'terminal') continue
    add(placeTab(tab, input), { id: tab.id, name: tab.name, kind, agent })
  }
  if (input.filter !== 'terminals') {
    for (const session of input.stored ?? []) {
      if (!isResumable(session)) continue
      add(placeStored(session, input), {
        id: `stored:${session.id}`,
        name: session.title ?? session.folderName ?? 'Untitled session',
        kind: 'agent',
        agent: session.agent,
        stored: { id: session.id, state: session.state as 'interrupted' | 'saved', bookmarked: Boolean(session.bookmarked) },
      })
    }
  }

  const labels = new Map(shown.map((workspace) => [sectionKey(workspace), workspace]))
  return [...sections.entries()].flatMap(([key, groups]) => {
    const listed = [...groups.values()].filter((group) => group.sessions.length > 0 || seeded.has(group.key))
    if (!listed.length && !scoped) return []
    const workspace = labels.get(key) ?? null
    return [{ key, label: workspace?.name ?? 'No workspace', workspaceId: workspace?.id ?? null, groups: numbered(listed) }]
  })
}
