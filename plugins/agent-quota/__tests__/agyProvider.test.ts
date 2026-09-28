import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { fetchAgyUsage } from '../src/providers/agy'

import { cliResult, fakeDeps, HOME, NOW } from './fakeDeps'

const USAGE = `Quota:
Gemini Models          Weekly Limit Remaining     55%   2026-10-02T08:47:03Z
Gemini Models          Five Hour Limit Remaining  82%   2026-09-28T07:11:00Z
Claude and GPT models  Weekly Limit Remaining     100%  2026-10-05T03:34:51Z
Claude and GPT models  Five Hour Limit Remaining  100%  2026-09-28T08:34:51Z`

const EXE = path.join(HOME, '.local', 'bin', 'agy.exe')
const LAUNCHER = path.join(HOME, '.local', 'bin', 'agy-work.cmd')

type RunCall = [string, string[], { env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number }]

describe('fetchAgyUsage', () => {
  it('runs agy -p /usage with a timeout of 30s or more', async () => {
    const run = vi.fn(async () => cliResult({ stdout: USAGE }))
    const deps = fakeDeps({}, { run, resolve: () => EXE })

    const snapshot = await fetchAgyUsage({}, deps)

    expect(snapshot).toMatchObject({
      source: 'cli',
      fetchedAt: NOW,
      windows: [
        { kind: 'session', usedPct: 18 },
        { kind: 'weekly', usedPct: 45 },
      ],
    })

    const [exe, args, options] = run.mock.calls[0] as unknown as RunCall
    expect(exe).toBe(EXE)
    expect(args).toEqual(['-p', '/usage'])
    expect(options.timeoutMs).toBeGreaterThanOrEqual(30_000)
    expect(options.cwd).toBe(deps.tmp)
  })

  it('runs through a launcher when provided', async () => {
    const run = vi.fn(async () => cliResult({ stdout: USAGE }))
    const resolveLauncher = vi.fn(() => LAUNCHER)
    const deps = fakeDeps({}, { run, resolve: () => EXE, resolveLauncher })

    await fetchAgyUsage({ launcher: 'agy-work' }, deps)

    expect(resolveLauncher).toHaveBeenCalledWith('agy-work')
    const [exe, args] = run.mock.calls[0] as unknown as RunCall
    expect(exe).toBe(LAUNCHER)
    expect(args).toEqual(['-p', '/usage'])
  })

  it('retries once, logs a sample, and reports parse_failed on unrecognized output', async () => {
    const run = vi.fn(async () => cliResult({ stdout: 'something unexpected' }))
    const deps = fakeDeps({}, { run, resolve: () => EXE })

    const result = await fetchAgyUsage({}, deps)

    expect(result).toMatchObject({ error: 'parse_failed', windows: [] })
    expect(run).toHaveBeenCalledTimes(2)
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('unrecognised agy -p /usage output'))
  })

  it('reports timeout without crashing', async () => {
    const timeout = fakeDeps({}, { run: vi.fn(async () => cliResult({ timedOut: true })), resolve: () => EXE })
    const result = await fetchAgyUsage({}, timeout)

    expect(result).toMatchObject({ error: 'timeout' })
  })

  it('reports not_signed_in without retrying', async () => {
    const run = vi.fn(async () => cliResult({ stderr: 'Please run /login to continue' }))
    const deps = fakeDeps({}, { run, resolve: () => EXE })

    const result = await fetchAgyUsage({}, deps)

    expect(result).toMatchObject({ error: 'not_signed_in' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported when CLI is not found', async () => {
    const deps = fakeDeps({}, { resolve: () => null })
    const result = await fetchAgyUsage({}, deps)

    expect(result).toMatchObject({ error: 'unsupported', message: 'Antigravity CLI not found.' })
  })
})
