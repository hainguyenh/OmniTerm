import type { Workspace } from '@omniterm/contract'
import { describe, expect, it } from 'vitest'

import { QUICK_START_AGENTS, quickStartProjects } from '../sessionQuickStart'

const ws = (id: string, ...paths: string[]) => ({ id, name: id, folders: paths.map(path => ({ path })) }) as unknown as Workspace

describe('quickStartProjects', () => {
  it('lists every folder of every workspace once', () => {
    const projects = quickStartProjects([ws('a', 'D:/work/app', 'D:/work/lib/'), ws('b', 'd:/WORK/app', 'E:/x')])
    expect(projects.map(p => [p.label, p.workspaceId])).toEqual([['app', 'a'], ['lib', 'a'], ['x', 'b']])
  })

  it('offers each agent plus a plain terminal', () => {
    expect(QUICK_START_AGENTS.map(a => a.id)).toEqual(['claude', 'codex', 'gemini', 'opencode', 'terminal'])
    expect(QUICK_START_AGENTS.find(a => a.id === 'terminal')?.command).toBeNull()
  })
})
