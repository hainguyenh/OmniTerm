import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AgentKind } from './types'

import { resolveExecutable, runCli, type CliRunner } from './cli'

/**
 * Everything the providers touch outside their own logic, so each one is testable with fakes.
 *
 * Deliberately absent: any network client and any way to read a credential file. The plugin's
 * only inputs are the agents' own CLIs (or the user's profile launchers) and Codex's rollout logs.
 */
export interface ProviderDeps {
  run: CliRunner
  readTail(file: string, bytes: number): Promise<string | null>
  listDir(dir: string): Promise<string[]>
  mtime(file: string): Promise<number | null>
  resolve(agent: AgentKind): string | null
  /** A validated launcher name (e.g. `claude-th`) → its script in the user's bin dir or PATH. */
  resolveLauncher(name: string): string | null
  home: string
  tmp: string
  env: NodeJS.ProcessEnv
  now(): number
  log(message: string): void
}

async function readTail(file: string, bytes: number): Promise<string | null> {
  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(file, 'r')
    const { size } = await handle.stat()
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

function candidates(agent: AgentKind, home: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') {
    return agent === 'claude'
      ? [path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude')]
      : [path.join(home, '.local', 'bin', 'codex')]
  }
  const appData = env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  const localAppData = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  if (agent === 'claude') {
    return [
      path.join(home, '.local', 'bin', 'claude.exe'),
      path.join(localAppData, 'Programs', 'Claude', 'claude.exe'),
      path.join(appData, 'npm', 'claude.cmd'),
    ]
  }
  return [
    path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    path.join(appData, 'npm', 'codex.cmd'),
  ]
}

/** Launchers live beside the agent in `~/.local/bin` by convention; PATH is searched after. */
function launcherCandidates(name: string, home: string): string[] {
  const bin = path.join(home, '.local', 'bin')
  return process.platform === 'win32'
    ? ['.cmd', '.bat', '.exe'].map((ext) => path.join(bin, name + ext))
    : [path.join(bin, name)]
}

export function createNodeDeps(log: (message: string) => void): ProviderDeps {
  const home = os.homedir()
  const env = process.env
  return {
    run: runCli,
    readTail,
    listDir: (dir) => fs.readdir(dir).catch(() => []),
    mtime: (file) => fs.stat(file).then((stat) => stat.mtimeMs, () => null),
    resolve: (agent) => resolveExecutable(agent, candidates(agent, home, env), env),
    resolveLauncher: (name) => resolveExecutable(name, launcherCandidates(name, home), env),
    home,
    tmp: os.tmpdir(),
    env,
    now: () => Date.now(),
    log,
  }
}
