import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { profileEnv, quoteForCmd, resolveExecutable, runCli } from '../src/cli'
import { createNodeDeps } from '../src/deps'

const node = process.execPath

describe('runCli', () => {
  it('captures output and the exit code with stdin closed', async () => {
    const result = await runCli(node, ['-e', 'process.stdin.on("end",()=>{console.log("out");console.error("err");process.exit(3)});process.stdin.resume()'], {
      env: process.env,
      timeoutMs: 10_000,
    })
    expect(result).toMatchObject({ code: 3, timedOut: false })
    expect(result.stdout.trim()).toBe('out')
    expect(result.stderr.trim()).toBe('err')
  })

  it('kills a process that outlives its timeout', async () => {
    const result = await runCli(node, ['-e', 'setTimeout(()=>{}, 30000)'], { env: process.env, timeoutMs: 200 })
    expect(result.timedOut).toBe(true)
  })

  it('reports a missing executable instead of throwing', async () => {
    const result = await runCli(path.join(os.tmpdir(), 'no-such-agent-binary'), [], { env: process.env, timeoutMs: 1000 })
    expect(result.code).toBeNull()
    expect(result.stderr).toMatch(/ENOENT|not found/i)
  })

  it.runIf(process.platform === 'win32')('runs a .cmd shim through cmd.exe with quoted arguments', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'agent quota '))
    const shim = path.join(dir, 'echo args.cmd')
    writeFileSync(shim, '@echo %~1^|%~2\r\n')
    const result = await runCli(shim, ['-p', 'hello there'], { env: process.env, timeoutMs: 10_000 })
    rmSync(dir, { recursive: true, force: true })
    expect(result.stdout.trim()).toBe('-p|hello there')
  })

  it.runIf(process.platform === 'win32')('refuses metacharacters for a .cmd shim', async () => {
    const result = await runCli('x.cmd', ['a&b'], { env: process.env, timeoutMs: 1000 })
    expect(result).toMatchObject({ code: null })
    expect(result.stderr).toContain('metacharacters')
  })
})

describe('quoteForCmd', () => {
  it('quotes only when needed and refuses shell syntax', () => {
    expect(quoteForCmd('-p')).toBe('-p')
    expect(quoteForCmd('a b')).toBe('"a b"')
    expect(quoteForCmd('')).toBe('""')
    for (const bad of ['a"b', '%x%', 'a^b', 'a&b', 'a|b', 'a<b', 'a>b', 'a!b', 'a\nb']) expect(() => quoteForCmd(bad), bad).toThrow()
  })
})

describe('resolveExecutable', () => {
  const exists = (known: string[]) => (file: string) => known.includes(file)

  it('prefers a known install location, then PATH', () => {
    expect(resolveExecutable('claude', ['/a/claude', '/b/claude'], { PATH: '' }, exists(['/b/claude']))).toBe('/b/claude')
    const dir = path.join('opt', 'bin')
    const ext = process.platform === 'win32' ? '.cmd' : ''
    const env = process.platform === 'win32' ? { Path: dir, PATHEXT: '.COM;.EXE;.CMD' } : { PATH: dir }
    expect(resolveExecutable('codex', [''], env, exists([path.join(dir, `codex${ext}`)]))).toBe(path.join(dir, `codex${ext}`))
    expect(resolveExecutable('codex', [], {}, exists([]))).toBeNull()
  })
})

describe('profileEnv', () => {
  it('sets a custom profile and unsets the default one, whatever the casing', () => {
    const base = { claude_config_dir: 'stale', PATH: 'p' }
    expect(profileEnv('CLAUDE_CONFIG_DIR', '/p/work', '/home/.claude', base)).toEqual({ PATH: 'p', CLAUDE_CONFIG_DIR: '/p/work' })
    expect(profileEnv('CLAUDE_CONFIG_DIR', '/home/.claude/', '/home/.claude', base)).toEqual({ PATH: 'p' })
    expect(profileEnv('CODEX_HOME', null, '/home/.codex', {})).toEqual({})
  })

  it('defaults to the process environment', () => {
    expect(profileEnv('CODEX_HOME', '/x', '/home/.codex').CODEX_HOME).toBe('/x')
  })
})

describe('createNodeDeps', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-quota-deps-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads tails, directories and mtimes, tolerating missing paths', async () => {
    const deps = createNodeDeps(() => {})
    const file = path.join(dir, 'a.txt')
    writeFileSync(file, 'hello world')
    expect(await deps.readTail(file, 5)).toBe('world')
    expect(await deps.readTail(file, 500)).toBe('hello world')
    expect(await deps.listDir(dir)).toContain('a.txt')
    expect(await deps.mtime(file)).toBeGreaterThan(0)
    const missing = path.join(dir, 'missing')
    expect(await deps.readTail(missing, 5)).toBeNull()
    expect(await deps.listDir(missing)).toEqual([])
    expect(await deps.mtime(missing)).toBeNull()
    expect(deps.now()).toBeGreaterThan(0)
    expect(deps.home).toBe(os.homedir())
  })

  it('resolves agents and launchers without failing when they are absent', () => {
    const deps = createNodeDeps(() => {})
    for (const found of [deps.resolve('claude'), deps.resolve('codex'), deps.resolveLauncher('claude-agent-quota-test-absent')]) {
      expect(found === null || typeof found === 'string').toBe(true)
    }
    expect(deps.resolveLauncher('claude-agent-quota-test-absent')).toBeNull()
  })

  it('offers no network client and no way to read a credential file', () => {
    const deps = createNodeDeps(() => {}) as unknown as Record<string, unknown>
    for (const key of ['fetchJson', 'localJson', 'readText', 'readFile']) expect(deps[key]).toBeUndefined()
  })
})
