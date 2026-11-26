import { describe, expect, it } from 'vitest'

import type { Connection, Workspace } from '../../../domain'
import { buildSessionsTree } from '../../../utils/sessionsTree'
import { countLiveAgents } from '../useSessionsBadge'

const conn = (id: string, localCwd: string): Connection =>
  ({ id, name: id, type: 'LOCAL', host: '', port: '', user: '', localCwd }) as Connection
const omni = { id: 'w1', name: 'OmniTerm', folders: [{ path: 'D:/workspace/OmniTerm' }] } as unknown as Workspace
const biz = { id: 'w2', name: 'BizReq', folders: [{ path: 'D:/workspace/BizReq' }] } as unknown as Workspace

describe('countLiveAgents', () => {
  const conns: Record<string, Connection> = {
    a: conn('a', 'D:/workspace/OmniTerm'),
    b: conn('b', 'D:/workspace/BizReq'),
  }
  const tabs = [
    { id: 't1', connId: 'a', name: 'claude' },
    { id: 't2', connId: 'b', name: 'claude' },
    { id: 't3', connId: 'b', name: 'claude' },
  ]
  const tree = (scopeWorkspaceId: string | null) => buildSessionsTree({
    tabs, workspaces: [omni, biz], connById: (id) => conns[id], isEditor: () => false,
    cwdOf: () => undefined, agentOf: () => 'claude', filter: 'agents', scopeWorkspaceId,
  })

  it('counts only the agents the scoped workspace lists, not every running pane', () => {
    expect(countLiveAgents(tree('w1'))).toBe(1)
    expect(countLiveAgents(tree('w2'))).toBe(2)
  })

  it('counts every workspace when the scope is all', () => {
    expect(countLiveAgents(tree(null))).toBe(3)
  })
})
