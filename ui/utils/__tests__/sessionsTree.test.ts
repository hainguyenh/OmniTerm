import type { Connection, Workspace } from '../../domain'
import { describe, expect, it } from 'vitest'

import type { StoredAgentSession } from '../agentSessionStorage'
import { buildSessionsTree, NO_WORKSPACE_SECTION, storedSessionCount, type SessionGroup, type SessionSection, type SessionsTreeInput } from '../sessionsTree'

const stored = (patch: Partial<StoredAgentSession>): StoredAgentSession => ({
  id: 'claude:s1', agent: 'claude', profileName: 'claude', sessionId: 's1', cwd: 'D:/workspace/OmniTerm/ui',
  state: 'interrupted', updatedAt: 1, ...patch,
}) as StoredAgentSession

const conn = (id: string, patch: Partial<Connection> = {}): Connection =>
  ({ id, name: id, type: 'LOCAL', host: '', port: '', user: '', ...patch }) as Connection
const workspace = { id: 'w1', name: 'OmniTerm', folders: [{ path: 'D:/workspace/OmniTerm' }] } as unknown as Workspace
const second = {
  id: 'w2', name: 'Web', folders: [{ path: 'D:/other/site', name: 'Site' }, { path: 'D:/other/api' }],
} as unknown as Workspace

function input(patch: Partial<SessionsTreeInput> = {}): SessionsTreeInput {
  const conns: Record<string, Connection> = {
    a: conn('a', { localCwd: 'D:/workspace/OmniTerm/ui' }),
    b: conn('b', { localCwd: 'D:/other/site' }),
    c: conn('c', { localCwd: 'E:/site' }),
    ssh: conn('ssh', { type: 'SSH', name: 'prod-api' }),
  }
  return {
    tabs: [
      { id: 't1', connId: 'a', name: 'pwsh' },
      { id: 't2', connId: 'a', name: 'claude' },
      { id: 't3', connId: 'b', name: 'pwsh' },
      { id: 't4', connId: 'ssh', name: 'prod' },
    ],
    workspaces: [workspace],
    connById: (id) => conns[id],
    isEditor: () => false,
    cwdOf: () => undefined,
    agentOf: (id) => (id === 't2' ? 'claude' : undefined),
    filter: 'all',
    scopeWorkspaceId: null,
    ...patch,
  }
}

/** Every group of every section, flattened, for the assertions that do not care about sections. */
const groupsOf = (sections: SessionSection[]): SessionGroup[] => sections.flatMap(section => section.groups)

const groups = (patch: Partial<SessionsTreeInput> = {}) => groupsOf(buildSessionsTree(input(patch)))

describe('buildSessionsTree', () => {
  it('groups sessions by workspace project, folder and connection name', () => {
    expect(groups().map(g => [g.label, g.sessions.map(s => s.id)])).toEqual([
      ['OmniTerm', ['t1', 't2']],
      ['site', ['t3']],
      ['prod-api', ['t4']],
    ])
  })

  it('splits every workspace into its own section, then the sessions of no workspace', () => {
    const sections = buildSessionsTree(input({ workspaces: [workspace, second] }))
    expect(sections.map(s => [s.key, s.label, s.groups.map(g => g.label)])).toEqual([
      ['section:w1', 'OmniTerm', ['OmniTerm']],
      ['section:w2', 'Web', ['Site']],
      [NO_WORKSPACE_SECTION, 'No workspace', ['prod-api']],
    ])
  })

  it('drops a workspace without sessions when every workspace is listed', () => {
    const sections = buildSessionsTree(input({ workspaces: [second, workspace], tabs: [{ id: 't1', connId: 'a', name: 'pwsh' }] }))
    expect(sections.map(s => s.label)).toEqual(['OmniTerm'])
  })

  it('shows only the scoped workspace, with its projects that have no session yet', () => {
    const sections = buildSessionsTree(input({ workspaces: [workspace, second], scopeWorkspaceId: 'w2' }))
    expect(sections).toHaveLength(1)
    expect(sections[0]?.groups.map(g => [g.label, g.sessions.map(s => s.id)])).toEqual([
      ['Site', ['t3']],
      ['api', []],
    ])
    const agents = buildSessionsTree(input({ workspaces: [workspace, second], scopeWorkspaceId: 'w2', filter: 'agents' }))
    expect(agents[0]?.groups).toEqual([])
  })

  it('keeps a connection of the scoped workspace that runs outside its folders', () => {
    const tabs = [{ id: 't4', connId: 'ssh', name: 'prod' }]
    const sections = buildSessionsTree(input({
      tabs,
      connById: () => conn('ssh', { type: 'SSH', name: 'prod-api', workspaceId: 'w1' }),
      scopeWorkspaceId: 'w1',
      filter: 'agents',
      agentOf: () => 'claude',
    }))
    expect(sections[0]?.groups.map(g => g.label)).toEqual(['prod-api'])
  })

  it('keeps a running agent visible when its project is no longer in the scoped workspace', () => {
    const tabs = [{ id: 'tx', connId: 'c', name: 'claude' }]
    const sections = buildSessionsTree(input({
      tabs,
      connById: () => conn('c', { type: 'LOCAL', localCwd: 'D:/removed/project' }),
      scopeWorkspaceId: 'w1',
      agentOf: () => 'claude',
    }))
    const listed = sections[0]?.groups.flatMap(g => g.sessions.map(s => s.id)) ?? []
    expect(listed).toContain('tx')
    const terminalOnly = buildSessionsTree(input({
      tabs,
      connById: () => conn('c', { type: 'LOCAL', localCwd: 'D:/removed/project' }),
      scopeWorkspaceId: 'w1',
    }))
    expect(terminalOnly[0]?.groups.flatMap(g => g.sessions.map(s => s.id))).not.toContain('tx')
  })

  it('marks agent sessions', () => {
    const [first] = groups()
    expect(first?.sessions.map(s => s.kind)).toEqual(['terminal', 'agent'])
    expect(first?.sessions[1]?.agent).toBe('claude')
  })

  it('filters to agents or terminals and drops emptied groups', () => {
    expect(groups({ filter: 'agents' }).map(g => g.sessions.map(s => s.id))).toEqual([['t2']])
    expect(groups({ filter: 'terminals' }).map(g => g.label)).toEqual(['OmniTerm', 'site', 'prod-api'])
  })

  it('skips editor tabs', () => {
    expect(groups({ isEditor: id => id === 't1' })[0]?.sessions.map(s => s.id)).toEqual(['t2'])
  })

  it('numbers distinct projects that share a folder name', () => {
    const tree = groups({ tabs: [{ id: 't3', connId: 'b', name: 'x' }, { id: 't5', connId: 'c', name: 'y' }] })
    expect(tree.map(g => g.label)).toEqual(['site', 'site (2)'])
  })

  it('prefers the live working directory over the saved one', () => {
    const tree = groups({ tabs: [{ id: 't3', connId: 'b', name: 'x' }], cwdOf: () => 'C:/live/dir/' })
    expect(tree[0]?.label).toBe('dir')
  })

  it('lists interrupted and bookmarked sessions under their project, ignoring active ones', () => {
    const tree = groups({
      stored: [stored({}), stored({ id: 'claude:s2', state: 'saved', bookmarked: true, title: 'Fix bug' }), stored({ id: 'claude:s3', state: 'active' })],
    })
    const nodes = tree[0]?.sessions.filter(s => s.stored) ?? []
    expect(nodes.map(n => [n.name, n.stored?.state, n.stored?.bookmarked])).toEqual([
      ['Untitled session', 'interrupted', false],
      ['Fix bug', 'saved', true],
    ])
  })

  it('shows only resumable sessions under the resume filter', () => {
    expect(groups({ filter: 'resume', stored: [stored({})] }).map(g => g.sessions.map(s => s.id))).toEqual([['stored:claude:s1']])
  })

  it('leaves remembered sessions out of the terminals filter', () => {
    expect(groups({ filter: 'terminals', stored: [stored({})] }).flatMap(g => g.sessions).some(s => s.stored)).toBe(false)
  })

  it('counts resumable sessions', () => {
    const all = [stored({}), stored({ id: 'x', state: 'saved' }), stored({ id: 'y', state: 'active' })]
    expect(storedSessionCount(buildSessionsTree(input({ filter: 'resume', stored: all })))).toBe(2)
  })

  it('counts only the resumable sessions the scoped workspace lists', () => {
    const all = [
      stored({ id: 'site', cwd: 'D:/other/site' }),
      stored({ id: 'api', cwd: 'D:/other/api/src' }),
      stored({ id: 'elsewhere', cwd: 'D:/workspace/OmniTerm' }),
    ]
    const sections = buildSessionsTree(input({ filter: 'resume', stored: all, workspaces: [workspace, second], scopeWorkspaceId: 'w2' }))
    expect(storedSessionCount(sections)).toBe(2)
  })
})
