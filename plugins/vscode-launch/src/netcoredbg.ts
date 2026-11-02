import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import type { EditorKind } from './types'

export interface NetCoreDbgDeps {
  env?: Readonly<Record<string, string | undefined>>
  homeDir?: string
  platform?: NodeJS.Platform
}

function findInExtensionsDir(extensionsRoot: string, binNames: readonly string[], maxDepth = 4): string | null {
  if (!fs.existsSync(extensionsRoot)) return null

  function search(dir: string, depth: number): string | null {
    if (depth > maxDepth) return null
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }

    for (const entry of entries) {
      if (entry.isFile() && binNames.includes(entry.name.toLowerCase())) {
        return path.join(dir, entry.name)
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const match = search(path.join(dir, entry.name), depth + 1)
      if (match) return match
    }
    return null
  }

  return search(extensionsRoot, 0)
}

function findExecutableOnPath(
  names: readonly string[],
  envPath: string | undefined,
  platform: NodeJS.Platform,
): string | null {
  if (!envPath) return null
  const delimiter = platform === 'win32' ? ';' : ':'
  const segments = envPath.split(delimiter).map((seg) => seg.trim()).filter(Boolean)
  for (const dir of segments) {
    for (const candidateName of names) {
      const candidate = path.join(dir, candidateName)
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate
        }
      } catch {
        // Ignore inaccessible PATH segments
      }
    }
  }
  return null
}

/**
 * Locate Samsung `netcoredbg` across explicit `NETCOREDBG_PATH`, `PATH`, VSCodium
 * (`~/.vscode-oss/extensions`), VS Code (`~/.vscode/extensions`), and common install locations.
 */
export function findNetCoreDbg(deps: NetCoreDbgDeps = {}): string | null {
  const env = deps.env ?? process.env
  const home = deps.homeDir ?? os.homedir()
  const platform = deps.platform ?? process.platform
  const isWin = platform === 'win32'
  // Only native binaries — never `.cmd` shims — so `spawn(..., { shell: false })` works safely.
  const binNames = isWin ? ['netcoredbg.exe'] : ['netcoredbg']

  const explicit = env.NETCOREDBG_PATH?.trim()
  if (explicit && fs.existsSync(explicit)) return explicit

  const fromPath = findExecutableOnPath(binNames, env.PATH ?? env.Path, platform)
  if (fromPath) return fromPath

  const extensionRoots = [
    path.join(home, '.vscode-oss', 'extensions'),
    path.join(home, '.codium', 'extensions'),
    path.join(home, '.vscode', 'extensions'),
  ]
  for (const extRoot of extensionRoots) {
    const found = findInExtensionsDir(extRoot, binNames)
    if (found) return found
  }

  const standardLocations = isWin
    ? [
        path.join(env.ProgramFiles ?? 'C:\\Program Files', 'netcoredbg', 'netcoredbg.exe'),
        path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs', 'netcoredbg', 'netcoredbg.exe'),
      ]
    : ['/usr/local/bin/netcoredbg', '/usr/bin/netcoredbg', '/opt/homebrew/bin/netcoredbg']

  for (const loc of standardLocations) {
    if (fs.existsSync(loc)) return loc
  }
  return null
}

/** Resolve the native binary or CLI wrapper for `codium` or `code` without relying on `shell: true`. */
export function resolveEditorBinary(
  editor: EditorKind,
  deps: NetCoreDbgDeps = {},
): { bin: string; isCmdShim: boolean } | null {
  const env = deps.env ?? process.env
  const home = deps.homeDir ?? os.homedir()
  const platform = deps.platform ?? process.platform
  const isWin = platform === 'win32'

  if (isWin) {
    const exeName = editor === 'codium' ? 'VSCodium.exe' : 'Code.exe'
    const appFolder = editor === 'codium' ? 'VSCodium' : 'Microsoft VS Code'
    const directExes = [
      path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs', appFolder, exeName),
      path.join(env.ProgramFiles ?? 'C:\\Program Files', appFolder, exeName),
    ]
    for (const exe of directExes) {
      if (fs.existsSync(exe)) return { bin: exe, isCmdShim: false }
    }

    const onPath = findExecutableOnPath([`${editor}.exe`, `${editor}.cmd`, editor], env.PATH ?? env.Path, platform)
    if (onPath) {
      if (/\.cmd$/i.test(onPath)) {
        const siblingExe = path.resolve(path.dirname(onPath), '..', exeName)
        if (fs.existsSync(siblingExe)) return { bin: siblingExe, isCmdShim: false }
        return { bin: onPath, isCmdShim: true }
      }
      return { bin: onPath, isCmdShim: false }
    }
    return null
  }

  const onPath = findExecutableOnPath([editor], env.PATH ?? env.Path, platform)
  if (onPath) return { bin: onPath, isCmdShim: false }

  const macAppBin = editor === 'codium'
    ? '/Applications/VSCodium.app/Contents/Resources/app/bin/codium'
    : '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
  if (fs.existsSync(macAppBin)) return { bin: macAppBin, isCmdShim: false }
  return null
}

/** Detect installed VS Code-family editors, preferring VSCodium (`codium`) first when present. */
export function detectInstalledEditors(deps: NetCoreDbgDeps = {}): EditorKind[] {
  const found: EditorKind[] = []
  if (resolveEditorBinary('codium', deps)) found.push('codium')
  if (resolveEditorBinary('code', deps)) found.push('code')
  return found
}

export function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close((closeErr) => {
        if (closeErr || port <= 0) reject(closeErr ?? new Error('Failed to allocate loopback port'))
        else resolve(port)
      })
    })
  })
}

export function buildNetCoreDbgAttachSnippet(params: {
  name: string
  port?: number
  pid?: number
  editor: EditorKind
  stopAtEntry?: boolean
}): string {
  const debuggerType = params.editor === 'codium' ? 'netcoredbg' : 'coreclr'
  const config: Record<string, unknown> = {
    name: `Attach: ${params.name}`,
    type: debuggerType,
    request: 'attach',
  }
  // When `netcoredbg --server=<port>` is used, VSCodium connects over TCP `debugServer` and must NOT
  // also pass `netcoredbg`'s own host PID as `processId`.
  if (params.port) {
    config.debugServer = params.port
  } else if (params.pid) {
    config.processId = String(params.pid)
  }
  if (params.stopAtEntry) {
    config.stopAtEntry = true
  }
  return JSON.stringify(config, null, 2)
}
