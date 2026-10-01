import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { activate, createService, deactivate, name, parseFetchRequest, parseWakeRequest } from '../src/index'
import { isSafePrompt } from '../src/prompt'
import { wakeAgent } from '../src/wake'

import { cliResult, fakeDeps, HOME } from './fakeDeps'

type InvokeHandler = (method: string, ...args: unknown[]) => unknown

describe('wakeAgent', () => {
  const claude = path.join(HOME, 'claude.exe')

  it('sends Claude one Haiku prompt in the temp directory for the profile', async () => {
    const run = vi.fn(async () => cliResult())
    const deps = fakeDeps({}, { run, resolve: () => claude })
    expect(await wakeAgent({ agent: 'claude', profileDir: 'D:\\p\\work', prompt: 'hi' }, deps)).toEqual({ ok: true })
    const [exe, args, options] = run.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv; cwd: string }]
    expect(exe).toBe(claude)
    expect(args).toEqual(['--tools', '', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', '-p', 'hi', '--model', 'haiku'])
    expect(options.env.CLAUDE_CONFIG_DIR).toBe('D:\\p\\work')
    expect(options.cwd).toBe(deps.tmp)
  })

  it('runs Codex read-only with its profile home', async () => {
    const run = vi.fn(async () => cliResult())
    await wakeAgent({ agent: 'codex', profileDir: 'D:\\c', prompt: 'hello there' }, fakeDeps({}, { run, resolve: () => 'codex' }))
    const [, args, options] = run.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }]
    expect(args).toEqual(['exec', '--skip-git-repo-check', '--sandbox', 'read-only', 'hello there'])
    expect(options.env.CODEX_HOME).toBe('D:\\c')
  })

  it('wakes through the profile launcher when the terminal used one', async () => {
    const run = vi.fn(async () => cliResult())
    const launcher = path.join(HOME, '.local', 'bin', 'claude-th.cmd')
    const deps = fakeDeps({}, { run, resolve: () => claude, resolveLauncher: () => launcher, env: { CLAUDE_CONFIG_DIR: 'stale' } })
    await wakeAgent({ agent: 'claude', launcher: 'claude-th', prompt: 'hi' }, deps)
    const [exe, args, options] = run.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }]
    expect(exe).toBe(launcher)
    expect(args).toEqual(['--tools', '', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', '-p', 'hi', '--model', 'haiku'])
    expect(options.env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
  })

  it('refuses unsafe prompts and missing CLIs', async () => {
    const deps = fakeDeps()
    expect(await wakeAgent({ agent: 'claude', prompt: 'hi & del *' }, deps)).toMatchObject({ ok: false, message: expect.stringContaining('letters') })
    expect(await wakeAgent({ agent: 'claude', prompt: 'hi' }, deps)).toMatchObject({ message: 'Claude Code CLI not found.' })
    expect(await wakeAgent({ agent: 'codex', prompt: 'hi' }, deps)).toMatchObject({ message: 'Codex CLI not found.' })
    expect(await wakeAgent({ agent: 'agy', prompt: 'hi' }, deps)).toMatchObject({ message: 'Antigravity CLI not found.' })
  })

  it('reports timeouts and failures', async () => {
    const timeout = fakeDeps({}, { resolve: () => claude, run: vi.fn(async () => cliResult({ timedOut: true })) })
    expect(await wakeAgent({ agent: 'claude', prompt: 'hi' }, timeout)).toMatchObject({ ok: false, message: 'The wake prompt timed out.' })
    const failed = fakeDeps({}, { resolve: () => claude, run: vi.fn(async () => cliResult({ code: 1, stderr: 'a\nrate limited' })) })
    expect(await wakeAgent({ agent: 'claude', prompt: 'hi' }, failed)).toMatchObject({ message: 'rate limited' })
    const silent = fakeDeps({}, { resolve: () => claude, run: vi.fn(async () => cliResult({ code: 2 })) })
    expect(await wakeAgent({ agent: 'claude', prompt: 'hi' }, silent)).toMatchObject({ message: 'The agent exited with code 2.' })
  })

  it('accepts only plain prompts', () => {
    expect(isSafePrompt('Xin chào, bạn khỏe không?')).toBe(true)
    for (const prompt of ['', '   ', 'a"b', 'a%PATH%', 'x'.repeat(121), 'a\nb', 'a|b']) expect(isSafePrompt(prompt), prompt).toBe(false)
  })
})

describe('request validation', () => {
  it('accepts well-formed requests and normalises empty directories', () => {
    expect(parseFetchRequest({ agent: 'claude', profileDir: '' })).toEqual({ agent: 'claude', profileDir: null, launcher: null })
    expect(parseFetchRequest({ agent: 'claude', launcher: 'claude-th' })).toEqual({ agent: 'claude', profileDir: null, launcher: 'claude-th' })
    expect(parseFetchRequest({ agent: 'agy', launcher: 'agy-work' })).toEqual({ agent: 'agy', profileDir: null, launcher: 'agy-work' })
    expect(parseWakeRequest({ agent: 'codex', profileDir: 'D:\\c', prompt: 'hi' })).toEqual({ agent: 'codex', profileDir: 'D:\\c', launcher: null, prompt: 'hi' })
  })

  it('rejects malformed requests', () => {
    expect(() => parseFetchRequest(null)).toThrow('Unknown agent')
    expect(() => parseFetchRequest({ agent: 'gpt' })).toThrow('Unknown agent')
    expect(() => parseFetchRequest({ agent: 'claude', profileDir: 5 })).toThrow('Invalid profile directory')
    expect(() => parseFetchRequest({ agent: 'claude', profileDir: 'a\0b' })).toThrow('Invalid profile directory')
    expect(() => parseFetchRequest({ agent: 'antigravity' })).toThrow('Unknown agent')
    for (const launcher of ['C:\\bin\\claude-th.cmd', 'claude-th & calc', 'codex-x', 'claude', 7]) {
      expect(() => parseFetchRequest({ agent: 'claude', launcher }), String(launcher)).toThrow('Invalid profile launcher')
    }
    expect(() => parseWakeRequest({ agent: 'claude', launcher: '../claude-x', prompt: 'hi' })).toThrow('Invalid profile launcher')
    expect(() => parseWakeRequest({ agent: 'x' })).toThrow('Unknown agent')
    expect(() => parseWakeRequest(undefined)).toThrow('Unknown agent')
    expect(() => parseWakeRequest({ agent: 'claude' })).toThrow('Missing wake prompt')
  })
})

describe('createService', () => {
  it('shares one in-flight probe per profile and routes by agent', async () => {
    let release: (() => void) | undefined
    const run = vi.fn(() => new Promise<ReturnType<typeof cliResult>>((resolve) => {
      release = () => resolve(cliResult({ stdout: 'Current session: 3% used' }))
    }))
    const service = createService(fakeDeps({}, { run, resolve: () => 'claude' }))
    const first = service.fetchUsage({ agent: 'claude', profileDir: 'D:\\P' })
    const second = service.fetchUsage({ agent: 'claude', profileDir: 'd:\\p' })
    expect(second).toBe(first)
    await vi.waitFor(() => expect(release).toBeDefined())
    release?.()
    expect(await first).toMatchObject({ windows: [{ usedPct: 3 }] })
    expect(run).toHaveBeenCalledTimes(1)
    expect(await service.fetchUsage({ agent: 'codex' })).toMatchObject({ error: 'unsupported' })
  })

  it('falls back to cachedUsageUtilization from config when claude /usage fails', async () => {
    const run = vi.fn(async () => cliResult({ stdout: 'Quick safety check: Do you trust this folder?' }))
    const cachedConfig = JSON.stringify({
      fetchedAtMs: 1234567,
      cachedUsageUtilization: {
        five_hour: { utilization: 12, resets_at: '2026-09-30T00:00:00.000Z' },
        seven_day: { utilization: 45, resets_at: '2026-10-05T00:00:00.000Z' },
      },
    })
    const readTail = vi.fn(async () => cachedConfig)
    const service = createService(fakeDeps({}, { run, readTail, resolve: () => 'claude' }))
    const snapshot = await service.fetchUsage({ agent: 'claude' })
    expect(snapshot).toMatchObject({
      fetchedAt: 1234567,
      source: 'cli',
      windows: [
        { kind: 'session', usedPct: 12 },
        { kind: 'weekly', usedPct: 45 },
      ],
    })
  })

  it('turns provider crashes into failed snapshots', async () => {
    const service = createService(fakeDeps({}, { listDir: () => { throw new Error('disk gone') } }))
    expect(await service.fetchUsage({ agent: 'codex' })).toMatchObject({ error: 'failed', message: 'disk gone' })
    const odd = createService(fakeDeps({}, { listDir: () => { throw 'odd' } }))
    expect(await odd.fetchUsage({ agent: 'codex' })).toMatchObject({ message: 'odd' })
  })

  it('serialises wakes per profile and survives failures', async () => {
    const run = vi.fn(async () => cliResult())
    const service = createService(fakeDeps({}, { run, resolve: () => 'claude' }))
    const one = service.wake({ agent: 'claude', prompt: 'hi' })
    expect(service.wake({ agent: 'claude', prompt: 'hi' })).toBe(one)
    expect(await one).toEqual({ ok: true })
    const broken = createService(fakeDeps({}, { resolve: () => { throw new Error('no') } }))
    expect(await broken.wake({ agent: 'claude', prompt: 'hi' })).toEqual({ ok: false, message: 'no' })
    const odd = createService(fakeDeps({}, { resolve: () => { throw 7 } }))
    expect(await odd.wake({ agent: 'claude', prompt: 'hi' })).toEqual({ ok: false, message: '7' })
  })
})

describe('plugin entry', () => {
  it('registers the handler, answers info and routes methods', async () => {
    let handler: InvokeHandler | undefined
    const log = vi.fn()
    const deps = fakeDeps({}, { run: vi.fn(async () => cliResult()), resolve: () => 'claude' })
    activate({ registerInvokeHandler: (registered) => { handler = registered }, services: { log } }, deps)
    expect(name).toBe('@omniterm/agent-quota')
    expect(log).toHaveBeenCalledWith('Agent Quota activated')
    expect(handler?.('agentQuota.info')).toEqual({ name: 'Agent Quota', agents: ['claude', 'codex', 'agy'] })
    expect(await handler?.('agentQuota.wake', { agent: 'claude', prompt: 'hi' })).toEqual({ ok: true })
    expect(await handler?.('agentQuota.fetchUsage', { agent: 'codex' })).toMatchObject({ error: 'unsupported' })
    // The hidden profile probe's scratch folder is the sidecar's own temp dir, never a renderer path.
    expect(handler?.('agentQuota.probeDir', 'C:\\elsewhere')).toBe(deps.tmp)
    expect(() => handler?.('agentQuota.nope')).toThrow('Unknown Agent Quota method "agentQuota.nope"')
    expect(deactivate()).toBeUndefined()
  })

  it('builds real Node deps by default and logs through the host', () => {
    let handler: InvokeHandler | undefined
    const log = vi.fn()
    activate({ registerInvokeHandler: (registered) => { handler = registered }, services: { log } })
    expect(handler?.('agentQuota.info')).toMatchObject({ name: 'Agent Quota' })
  })
})
