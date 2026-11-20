import type { Workspace } from '../../domain'
import { describe, expect, it } from 'vitest'

import { claudeProfileChoices, QUICK_START_AGENTS, quickStartProjects } from '../sessionQuickStart'

const ws = (id: string, ...paths: string[]) => ({ id, name: id, folders: paths.map(path => ({ path })) }) as unknown as Workspace

describe('quickStartProjects', () => {
  it('lists every folder of every workspace once', () => {
    const projects = quickStartProjects([ws('a', 'D:/work/app', 'D:/work/lib/'), ws('b', 'd:/WORK/app', 'E:/x')])
    expect(projects.map(p => [p.label, p.workspaceId])).toEqual([['app', 'a'], ['lib', 'a'], ['x', 'b']])
  })

  it('leaves disabled folders out', () => {
    const disabled = { id: 'x', name: 'x', path: 'D:/work/off', disabled: true }
    const workspace = { ...ws('a', 'D:/work/app'), folders: [{ id: 'f', name: 'app', path: 'D:/work/app' }, disabled] } as unknown as Workspace
    expect(quickStartProjects([workspace]).map(p => p.label)).toEqual(['app'])
  })

  it('offers each agent plus a plain terminal', () => {
    expect(QUICK_START_AGENTS.map(a => a.id)).toEqual(['claude', 'codex', 'agy', 'gemini', 'opencode', 'terminal'])
    expect(QUICK_START_AGENTS.find(a => a.id === 'terminal')?.command).toBeNull()
  })
})

describe('claudeProfileChoices', () => {
  it('lists the default first, then launchers by name, and ignores other agents and bare directories', () => {
    const choices = claudeProfileChoices([
      { agent: 'claude', profileName: 'claude-work', profileDir: null, launcher: 'claude-work' },
      { agent: 'codex', profileName: 'codex-alt', profileDir: null, launcher: 'codex-alt' },
      { agent: 'claude', profileName: 'claude-dir', profileDir: 'C:/u/.claude-dir', launcher: null },
      { agent: 'claude', profileName: 'claude-a', profileDir: null, launcher: 'claude-a' },
      { agent: 'claude', profileName: 'claude-work', profileDir: null, launcher: 'Claude-Work' },
    ])
    expect(choices.map(c => c.command)).toEqual(['claude', 'claude-a', 'claude-work'])
  })

  it('falls back to the default alone', () => {
    expect(claudeProfileChoices([])).toEqual([{ label: 'claude (default)', command: 'claude' }])
  })
})

describe('the Google agent', () => {
  it('defaults to Antigravity, ahead of Gemini CLI', () => {
    const google = QUICK_START_AGENTS.filter(a => a.id === 'agy' || a.id === 'gemini')
    expect(google.map(a => a.command)).toEqual(['agy', 'gemini'])
  })
})
