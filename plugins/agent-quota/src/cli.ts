import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface CliResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface CliOptions {
  env: NodeJS.ProcessEnv
  timeoutMs: number
  cwd?: string
}

export type CliRunner = (command: string, args: string[], options: CliOptions) => Promise<CliResult>

const OUTPUT_CAP = 256 * 1024

/**
 * cmd.exe quoting for a `.cmd` shim, which Node refuses to spawn without a shell. Arguments are
 * validated upstream (fixed flags, or a prompt restricted to letters, digits and punctuation that
 * cmd does not interpret), so wrapping in quotes is enough; this still refuses the metacharacters
 * rather than trusting every caller.
 */
export function quoteForCmd(arg: string): string {
  if (/["%^&|<>!\r\n]/.test(arg)) throw new Error('Refusing to pass shell metacharacters to cmd.exe')
  return /[\s,;=()]/.test(arg) || arg === '' ? `"${arg}"` : arg
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {})
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

/** Run a CLI hidden, with stdin closed (Claude Code waits ~3 s for stdin otherwise) and a hard timeout. */
export const runCli: CliRunner = (command, args, { env, timeoutMs, cwd }) => new Promise((resolve) => {
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  let child
  try {
    child = shell
      ? spawn([command, ...args].map(quoteForCmd).join(' '), { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
      : spawn(command, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    resolve({ code: null, stdout: '', stderr: String(error), timedOut: false })
    return
  }
  let stdout = ''
  let stderr = ''
  let timedOut = false
  const append = (current: string, chunk: Buffer) => (current.length < OUTPUT_CAP ? current + chunk.toString('utf8') : current)
  child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
  child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
  const timer = setTimeout(() => {
    timedOut = true
    killTree(child.pid)
  }, timeoutMs)
  child.on('error', (error) => {
    clearTimeout(timer)
    resolve({ code: null, stdout, stderr: stderr || String(error), timedOut })
  })
  child.on('close', (code) => {
    clearTimeout(timer)
    resolve({ code, stdout, stderr, timedOut })
  })
})

/** First existing candidate, then a PATH search honouring PATHEXT on Windows. */
export function resolveExecutable(
  name: string,
  candidates: string[],
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
): string | null {
  const direct = candidates.find((candidate) => candidate && exists(candidate))
  if (direct) return direct
  const windows = process.platform === 'win32'
  const extensions = windows
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((ext) => ext.toLowerCase()).filter((ext) => ['.exe', '.cmd', '.bat'].includes(ext))
    : ['']
  const dirs = (env.PATH ?? env.Path ?? '').split(windows ? ';' : ':').filter(Boolean)
  for (const dir of dirs) {
    for (const ext of extensions) {
      const file = path.join(dir, name + ext)
      if (exists(file)) return file
    }
  }
  return null
}

/**
 * Environment for a probe against one profile. The agent's default directory is expressed by
 * *unsetting* the variable: `CLAUDE_CONFIG_DIR=~/.claude` is not the same as no variable, because
 * the default profile keeps its account file at `~/.claude.json`, outside the directory.
 */
export function profileEnv(
  variable: 'CLAUDE_CONFIG_DIR' | 'CODEX_HOME' | 'AGY_HOME',
  profileDir: string | null | undefined,
  defaultDir: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === variable) delete env[key]
  }
  const normalize = (dir: string) => path.resolve(dir).replace(/[\\/]+$/, '').toLowerCase()
  if (profileDir && normalize(profileDir) !== normalize(defaultDir)) env[variable] = profileDir
  return env
}
