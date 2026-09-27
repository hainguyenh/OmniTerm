import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { fetchClaudeUsage, redactSample } from '../src/providers/claude'

import { cliResult, fakeDeps, HOME, NOW } from './fakeDeps'

const USAGE = readFileSync(path.join(__dirname, 'fixtures', 'claude-usage', 'current-2026-09.txt'), 'utf8')
const PROFILE = path.join(HOME, 'claude-profiles', 'claude-work')
const EXE = path.join(HOME, '.local', 'bin', 'claude.exe')
const LAUNCHER = path.join(HOME, '.local', 'bin', 'claude-th.cmd')

type RunCall = [string, string[], { env: NodeJS.ProcessEnv; cwd: string }]

describe('fetchClaudeUsage', () => {
  it('runs the profile launcher the terminal used, leaving the profile to it', async () => {
    const run = vi.fn(async () => cliResult({ stdout: USAGE }))
    const resolveLauncher = vi.fn(() => LAUNCHER)
    const deps = fakeDeps({}, { run, resolveLauncher, resolve: () => EXE, env: { PATH: '', CLAUDE_CONFIG_DIR: 'C:\\elsewhere' } })
    const snapshot = await fetchClaudeUsage({ launcher: 'claude-th', profileDir: PROFILE }, deps)
    expect(snapshot).toMatchObject({ source: 'cli', fetchedAt: NOW, windows: [{ usedPct: 46 }, { usedPct: 87 }] })
    expect(resolveLauncher).toHaveBeenCalledWith('claude-th')
    const [exe, args, options] = run.mock.calls[0] as unknown as RunCall
    expect(exe).toBe(LAUNCHER)
    expect(args).toEqual(['-p', '/usage'])
    expect(options.env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
    expect(options.cwd).toBe(deps.tmp)
  })

  it('falls back to claude with the profile directory without a usable launcher', async () => {
    const run = vi.fn(async () => cliResult({ stdout: USAGE }))
    const deps = fakeDeps({}, { run, resolve: () => EXE })
    await fetchClaudeUsage({ launcher: 'claude-gone', profileDir: PROFILE }, deps)
    await fetchClaudeUsage({ launcher: 'not a launcher', profileDir: PROFILE }, deps)
    for (const call of run.mock.calls as unknown as RunCall[]) {
      expect(call[0]).toBe(EXE)
      expect(call[2].env.CLAUDE_CONFIG_DIR).toBe(PROFILE)
    }
  })

  it('unsets the variable for the default profile', async () => {
    const run = vi.fn(async () => cliResult({ stdout: USAGE }))
    await fetchClaudeUsage({ profileDir: null }, fakeDeps({}, { run, resolve: () => EXE, env: { CLAUDE_CONFIG_DIR: 'x' } }))
    expect((run.mock.calls[0] as unknown as RunCall)[2].env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
  })

  it('retries once, logs a redacted sample, then reports parse_failed', async () => {
    const run = vi.fn(async () => cliResult({ stdout: 'something new' }))
    const deps = fakeDeps({}, { run, resolve: () => EXE })
    expect(await fetchClaudeUsage({ profileDir: PROFILE }, deps)).toMatchObject({ error: 'parse_failed', windows: [] })
    expect(run).toHaveBeenCalledTimes(2)
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('unrecognised claude /usage output'))
  })

  it('reports timeouts and a signed-out profile without retrying the latter', async () => {
    const timeout = fakeDeps({}, { run: vi.fn(async () => cliResult({ timedOut: true })), resolve: () => EXE })
    expect(await fetchClaudeUsage({ profileDir: PROFILE }, timeout)).toMatchObject({ error: 'timeout' })
    const run = vi.fn(async () => cliResult({ stderr: 'Please run /login' }))
    expect(await fetchClaudeUsage({ profileDir: PROFILE }, fakeDeps({}, { run, resolve: () => EXE }))).toMatchObject({ error: 'not_signed_in' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('says so when the CLI is not installed', async () => {
    expect(await fetchClaudeUsage({ profileDir: PROFILE }, fakeDeps())).toMatchObject({ error: 'unsupported', message: 'Claude Code CLI not found.' })
  })
})

describe('redactSample', () => {
  it('masks emails and token-shaped strings and caps length', () => {
    const sample = redactSample(`me@example.com sk-ant-abcdefgh1234 ${'A'.repeat(40)} ${'x'.repeat(2000)}`)
    expect(sample).toContain('<email>')
    expect(sample).not.toContain('sk-ant')
    expect(sample.length).toBeLessThanOrEqual(1024)
  })
})
