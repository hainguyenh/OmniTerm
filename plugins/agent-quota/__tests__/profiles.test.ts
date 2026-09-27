import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { activate } from '../src/index'
import { listProfiles } from '../src/profiles'

import { fakeDeps, HOME } from './fakeDeps'

type InvokeHandler = (method: string, ...args: unknown[]) => unknown

const bin = path.join(HOME, '.local', 'bin')
const tools = path.join(HOME, 'tools')

describe('listProfiles', () => {
  it('lists default profiles that exist, then runnable launchers from ~/.local/bin and PATH', async () => {
    const deps = fakeDeps({
      [path.join(HOME, '.claude', 'settings.json')]: '{}',
      [path.join(bin, 'claude-work.cmd')]: '',
      [path.join(bin, 'claude.exe')]: '',
      [path.join(tools, 'claude-th.CMD')]: '',
      [path.join(tools, 'claude-WORK.bat')]: '',
      [path.join(tools, 'codex-alt.exe')]: '',
      [path.join(tools, 'claude-notes.ps1')]: '',
      [path.join(tools, 'claude-bad name.cmd')]: '',
      [path.join(tools, 'readme.txt')]: '',
    }, {
      env: { PATH: `${tools};${tools};` },
      mtime: async (file) => (file === path.join(HOME, '.claude') ? 1 : null),
    })
    expect(await listProfiles(deps, 'win32')).toEqual([
      { agent: 'claude', profileName: 'claude', profileDir: path.join(HOME, '.claude'), launcher: null },
      { agent: 'claude', profileName: 'claude-th', profileDir: null, launcher: 'claude-th' },
      { agent: 'claude', profileName: 'claude-work', profileDir: null, launcher: 'claude-work' },
      { agent: 'codex', profileName: 'codex-alt', profileDir: null, launcher: 'codex-alt' },
    ])
  })

  it('takes extensionless launchers on unix, case-sensitively', async () => {
    const deps = fakeDeps({
      [path.join(bin, 'claude-work')]: '',
      [path.join(bin, 'claude-Work')]: '',
      [path.join(bin, 'claude-work.sh')]: '',
    }, { env: { PATH: '' } })
    expect((await listProfiles(deps, 'linux')).map((profile) => profile.launcher)).toEqual(['claude-Work', 'claude-work', 'claude-work.sh'])
  })

  it('skips unreadable directories instead of failing the listing', async () => {
    const deps = fakeDeps({}, {
      env: { PATH: tools },
      listDir: async (dir) => {
        if (dir === tools) throw new Error('denied')
        return dir === bin ? ['claude-a.cmd'] : []
      },
      mtime: async () => { throw new Error('denied') },
    })
    expect(await listProfiles(deps, 'win32')).toEqual([{ agent: 'claude', profileName: 'claude-a', profileDir: null, launcher: 'claude-a' }])
  })

  it('caps the listing', async () => {
    const names = Array.from({ length: 80 }, (_, index) => `claude-p${String(index).padStart(2, '0')}.cmd`)
    const deps = fakeDeps({}, { listDir: async (dir) => (dir === bin ? names : []) })
    expect(await listProfiles(deps, 'win32')).toHaveLength(50)
  })

  it('is served as agentQuota.listProfiles', async () => {
    let handler: InvokeHandler | undefined
    const deps = fakeDeps({}, { listDir: async (dir) => (dir === bin ? ['claude-x.cmd'] : []) })
    activate({ registerInvokeHandler: (registered) => { handler = registered }, services: { log: vi.fn() } }, deps)
    const listed = await handler?.('agentQuota.listProfiles') as Array<{ launcher: string | null }>
    expect(listed.map((profile) => profile.launcher)).toContain('claude-x')
  })
})
