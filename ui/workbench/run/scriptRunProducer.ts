import type { RunConfig } from '../../ide/platform/ipc'
import { startRun, type RunSession } from '../../ide/features/run/store'

export type ScriptType = 'sh' | 'bat' | 'cmd' | 'ps1'

export interface CreateScriptRunConfigOptions {
  path: string
  name?: string
  cwd?: string | null
  args?: string[]
  env?: Record<string, string>
}

const SCRIPT_REGEX = /\.(sh|bash|zsh|bat|cmd|ps1)$/i

/**
 * Checks whether the given path corresponds to a supported runnable script.
 */
export function isScriptPath(filePath: string): boolean {
  return SCRIPT_REGEX.test(filePath)
}

/**
 * Determines the script type from the file extension.
 */
export function getScriptType(filePath: string): ScriptType | null {
  const match = filePath.match(/\.(sh|bash|zsh|bat|cmd|ps1)$/i)
  if (!match || !match[1]) return null
  const ext = match[1].toLowerCase()
  if (ext === 'bat') return 'bat'
  if (ext === 'cmd') return 'cmd'
  if (ext === 'ps1') return 'ps1'
  return 'sh'
}

function getFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || filePath
}

function getDirName(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash > 0 ? normalized.substring(0, lastSlash) : null
}

function isWindowsPlatform(): boolean {
  return typeof process !== 'undefined' && process.platform === 'win32'
}

/**
 * Creates a RunConfig bridging a workspace script (.sh, .bat, .ps1, .cmd)
 * to the unified execution runner.
 */
export function createScriptRunConfig(options: CreateScriptRunConfigOptions): RunConfig {
  const type = getScriptType(options.path)
  const isWin = isWindowsPlatform()
  const scriptArgs = options.args ?? []

  let command: string
  let args: string[]

  switch (type) {
    case 'ps1':
      command = isWin ? 'powershell.exe' : 'pwsh'
      args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', options.path, ...scriptArgs]
      break
    case 'bat':
    case 'cmd':
      command = isWin ? 'cmd.exe' : 'sh'
      args = isWin ? ['/c', options.path, ...scriptArgs] : [options.path, ...scriptArgs]
      break
    case 'sh':
    default:
      command = isWin ? 'bash' : 'sh'
      args = [options.path, ...scriptArgs]
      break
  }

  const name = options.name ?? getFileName(options.path)
  const cwd = options.cwd ?? getDirName(options.path)
  const normalizedPath = options.path.replace(/\\/g, '/')

  return {
    id: `omniterm:script:${normalizedPath}`,
    name,
    kind: 'shell',
    command,
    args,
    cwd,
    env: options.env ?? {},
    detected: true,
    isTest: false,
    debugAdapter: null,
  }
}

/**
 * Discovers runnable script files within a set of workspace file entries.
 */
export function discoverWorkspaceScripts(
  entries: Array<{ path: string; isDir?: boolean }>,
  options?: { cwd?: string },
): RunConfig[] {
  const configs: RunConfig[] = []
  for (const entry of entries) {
    if (entry.isDir) continue
    if (isScriptPath(entry.path)) {
      configs.push(
        createScriptRunConfig({
          path: entry.path,
          cwd: options?.cwd,
        }),
      )
    }
  }
  return configs
}

/**
 * Executes a workspace script directly through the unified run runner.
 */
export async function runScriptWithUnifiedRunner(
  scriptPath: string,
  options?: { args?: string[]; cwd?: string; env?: Record<string, string> },
): Promise<RunSession | null> {
  const config = createScriptRunConfig({
    path: scriptPath,
    cwd: options?.cwd,
    args: options?.args,
    env: options?.env,
  })
  return startRun(config)
}
