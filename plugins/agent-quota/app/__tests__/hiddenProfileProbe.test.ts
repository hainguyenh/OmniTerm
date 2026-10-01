import { describe, expect, it, vi } from 'vitest'

import type { QuotaSnapshot } from '../../src/types'
import type { HiddenTerminal } from '../../../../ui/utils/hiddenTerminal'
import type { HiddenProbeDeps, HiddenProbeTarget } from '../hiddenProfileProbe'

import { launchCommandFor, probeProfilesHidden } from '../hiddenProfileProbe'
import { PERMISSIONS_TRUST, PERMISSIONS_TRUST_ON_YES } from './trustScreens'

const T0 = Date.UTC(2026, 8, 25, 3, 0)
const SHELL = 'PS C:\\Temp\\omniterm-wake>'
const AGENT = ['╭──────────────╮', '│ >            │', '╰──────────────╯', '  ? for shortcuts']
const TRUST = ['Quick safety check: Do you trust the files in this folder?', '❯ 1. Yes, proceed', '  2. No, exit']
const PANEL = ['Current session', '██████   19% used', 'Resets 3pm (UTC)', '', 'Current week (all models)', '███   8% used']

const target = (launcher: string | null, profileDir: string | null = null): HiddenProbeTarget =>
  ({ key: `claude:${launcher ?? profileDir}`, agent: 'claude', profileDir, launcher })

/**
 * A shell that starts a Claude-like agent for any `claude*` line: the first start in the scratch
 * folder asks about trust, `/usage` draws the panel, Esc closes it, `/exit` returns to the shell.
 */
function fakeHidden(options: { broken?: string; silent?: string; trust?: string[] } = {}) {
  let now = T0
  const sent: string[] = []
  const listeners = new Set<(text: string) => void>()
  let screen = [SHELL]
  let mode: 'shell' | 'trust' | 'agent' = 'shell'
  let trusted = false
  let running = ''
  let pending = ''
  const draw = (next: string[]) => {
    screen = next
    for (const listener of listeners) listener(next.join('\r\n'))
  }
  const onLine = (line: string) => {
    if (mode === 'shell') {
      if (!line.includes('claude')) return draw([SHELL])
      if (options.broken && line.includes(options.broken)) return draw([`${SHELL} ${line}`, `${line}: not recognized`, SHELL])
      running = line
      mode = trusted ? 'agent' : 'trust'
      return draw(trusted ? AGENT : options.trust ?? TRUST)
    }
    // Enter on the bare-option dialog confirms whatever the cursor is on: "No, exit" quits.
    if (mode === 'trust' && screen === PERMISSIONS_TRUST && line === '') {
      mode = 'shell'
      return draw([SHELL])
    }
    if (mode === 'trust' && (line === '1' || line === '')) {
      trusted = true
      mode = 'agent'
      return draw(AGENT)
    }
    if (mode === 'agent' && line === '/usage' && !running.includes(options.silent ?? '____none____')) return draw([...AGENT, ...PANEL])
    if (mode === 'agent' && line === '/exit') {
      mode = 'shell'
      return draw([SHELL])
    }
  }
  const closed = vi.fn(async () => {})
  const term: HiddenTerminal = {
    send: (data) => {
      sent.push(data)
      if (data === '\x1b[B' && screen === PERMISSIONS_TRUST) return draw(PERMISSIONS_TRUST_ON_YES)
      if (data === '\x1b') return mode === 'agent' ? draw(AGENT) : undefined
      if (data === '\x03') {
        mode = 'shell'
        return draw([SHELL])
      }
      if (!data.endsWith('\r')) {
        pending += data
        return
      }
      const line = pending + data.slice(0, -1)
      pending = ''
      onLine(line)
    },
    screen: () => screen,
    onOutput: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close: closed,
  }
  const open = vi.fn(async () => term)
  const deps: HiddenProbeDeps = {
    probeDir: async () => 'C:\\Temp\\omniterm-wake',
    open,
    now: () => now,
    sleep: async (ms) => { now += ms },
  }
  return { deps, sent, open, closed }
}

async function collect(targets: HiddenProbeTarget[], deps: HiddenProbeDeps) {
  const results: Record<string, QuotaSnapshot> = {}
  const skipped = await probeProfilesHidden(targets, deps, (key, snapshot) => { results[key] = snapshot })
  return { results, skipped }
}

describe('hidden profile probe', () => {
  it('reads each profile in turn in one hidden terminal, trusting the scratch folder, then closes it', async () => {
    const { deps, sent, open, closed } = fakeHidden()
    const { results, skipped } = await collect([target('claude-a'), target('claude-b')], deps)

    expect(skipped).toEqual([])
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('C:\\Temp\\omniterm-wake')
    for (const key of ['claude:claude-a', 'claude:claude-b']) {
      expect(results[key].windows.map((window) => [window.kind, window.usedPct])).toEqual([['session', 19], ['weekly', 8]])
    }
    expect(sent).toEqual([
      'claude-a\r', '1\r', '/usage', '\r', '\x1b', '/exit', '\r',
      'claude-b\r', '/usage', '\r', '\x1b', '/exit', '\r',
    ])
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('picks "Yes, I trust this folder" with an arrow in the bare-option dialog (regression)', async () => {
    const { deps, sent } = fakeHidden({ trust: PERMISSIONS_TRUST })
    const { results } = await collect([target('claude-a')], deps)

    expect(results['claude:claude-a'].windows).toHaveLength(2)
    expect(sent.slice(0, 4)).toEqual(['claude-a\r', '\x1b[B', '\r', '/usage'])
  })

  it('reports a launcher that does not start, and one whose panel never comes, then carries on', async () => {
    const { deps, sent, closed } = fakeHidden({ broken: 'claude-gone', silent: 'claude-mute' })
    const { results } = await collect([target('claude-gone'), target('claude-mute'), target('claude-ok')], deps)

    expect(results['claude:claude-gone']).toMatchObject({ error: 'failed', message: 'claude-gone did not start.' })
    expect(results['claude:claude-mute']).toMatchObject({ error: 'timeout' })
    expect(results['claude:claude-ok'].windows).toHaveLength(2)
    // The mute agent is still left with /exit before the next launcher runs.
    expect(sent.indexOf('claude-ok\r')).toBeGreaterThan(sent.indexOf('/exit'))
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('reads a custom profile directory in the hidden terminal by setting its environment', async () => {
    const { deps, sent } = fakeHidden()
    const custom = target(null, 'D:\\profiles\\work')
    const { results, skipped } = await collect([custom], deps)

    expect(skipped).toEqual([])
    expect(results[custom.key].windows).toHaveLength(2)
    expect(sent.some((cmd) => cmd.includes('CLAUDE_CONFIG_DIR') && cmd.includes('claude'))).toBe(true)
  })

  it('hands back profiles it cannot start, and everything when no hidden terminal opens', async () => {
    const unstartable: HiddenProbeTarget = { key: 'other:none', agent: 'unsupported' as any, profileDir: null, launcher: null }
    const { deps, open } = fakeHidden()
    expect((await collect([unstartable], deps)).skipped).toEqual([unstartable.key])
    expect(open).not.toHaveBeenCalled()

    const refused = fakeHidden()
    const targets = [target('claude-a'), unstartable]
    expect((await collect(targets, { ...refused.deps, open: async () => null })).skipped).toEqual(targets.map((t) => t.key))
    expect((await collect(targets, { ...refused.deps, probeDir: async () => null })).skipped).toEqual(targets.map((t) => t.key))
  })
})

describe('launchCommandFor', () => {
  it('runs the launcher, the bare agent for default profile, or sets environment for custom directory', () => {
    expect(launchCommandFor(target('claude-th'))).toBe('claude-th')
    expect(launchCommandFor(target(null, 'C:\\Users\\me\\.claude'))).toBe('claude')
    expect(launchCommandFor(target(null, '/home/me/.claude/'))).toBe('claude')
    expect(launchCommandFor(target(null, null))).toBe('claude')
    const custom = launchCommandFor(target(null, 'D:\\profiles\\work'))
    expect(custom).toContain('CLAUDE_CONFIG_DIR')
    expect(custom).toContain('claude')
    expect(launchCommandFor({ key: 'none', agent: 'unsupported' as any, profileDir: null, launcher: null })).toBeNull()
  })
})
