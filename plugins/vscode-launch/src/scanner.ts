import fs from 'node:fs'
import path from 'node:path'

import { parseLaunchJsonText } from './parser'
import type {
  DiscoveredLaunchFile,
  DiscoveryResult,
  EditorKind,
  LaunchCompoundItem,
  LaunchConfigItem,
  ParsedLaunchFile,
  RawCompoundItem,
  RawCompoundTarget,
} from './types'

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.vscode',
  '.idea',
  '.next',
  '.nuxt',
  '.turbo',
  '.venv',
  'venv',
  'node_modules',
  'target',
  'dist',
  'build',
  'bin',
  'obj',
  'coverage',
  'out',
])

interface CachedFileEntry {
  mtimeMs: number
  size: number
  parsed: ParsedLaunchFile
}

export interface LaunchScannerOptions {
  maxDepth?: number
}

const normalizeRelFolder = (rel: string): string => {
  const forward = rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return forward === '' ? '.' : forward
}

function resolveCompoundTarget(
  target: RawCompoundTarget,
  ownerFolder: string,
  runnableConfigs: readonly LaunchConfigItem[],
): LaunchConfigItem | undefined {
  if (target.folder) {
    const cleanTargetFolder = normalizeRelFolder(target.folder)
    const exact = runnableConfigs.find(
      (cfg) =>
        cfg.name === target.name &&
        (cfg.relativeFolder === cleanTargetFolder || path.basename(cfg.workspaceFolder) === cleanTargetFolder),
    )
    if (exact) return exact
  }
  const sameFolder = runnableConfigs.find(
    (cfg) => cfg.relativeFolder === ownerFolder && cfg.name === target.name,
  )
  if (sameFolder) return sameFolder
  return runnableConfigs.find((cfg) => cfg.name === target.name)
}

export function createLaunchScanner(options: LaunchScannerOptions = {}) {
  const maxDepth = options.maxDepth ?? 4
  const fileCache = new Map<string, CachedFileEntry>()

  function readCachedOrParse(
    launchJsonPath: string,
    workspaceFolder: string,
    relativeFolder: string,
  ): ParsedLaunchFile | null {
    let stat: fs.Stats
    try {
      stat = fs.statSync(launchJsonPath)
    } catch {
      fileCache.delete(launchJsonPath)
      return null
    }
    if (!stat.isFile()) return null

    const cached = fileCache.get(launchJsonPath)
    if (
      cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size &&
      cached.parsed.relativeFolder === relativeFolder
    ) {
      return cached.parsed
    }

    let raw = ''
    try {
      raw = fs.readFileSync(launchJsonPath, 'utf8')
    } catch (err) {
      return {
        version: '',
        workspaceFolder,
        relativeFolder,
        configurations: [],
        compounds: [],
        error: `Could not read launch.json: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    const parsed = parseLaunchJsonText(raw, workspaceFolder, relativeFolder)
    fileCache.set(launchJsonPath, { mtimeMs: stat.mtimeMs, size: stat.size, parsed })
    return parsed
  }

  function discover(rootDir: string, editors: EditorKind[] = []): DiscoveryResult {
    const resolvedRoot = path.resolve(rootDir)
    if (!fs.existsSync(resolvedRoot)) {
      return { rootDir: resolvedRoot, files: [], compounds: [], editors }
    }

    const visitedRealPaths = new Set<string>()
    const foundFolders: Array<{ workspaceFolder: string; relativeFolder: string; launchJsonPath: string }> = []

    function walk(currentDir: string, depth: number): void {
      if (depth > maxDepth) return
      let realCurrent: string
      try {
        realCurrent = fs.realpathSync(currentDir)
      } catch {
        return
      }
      const key = process.platform === 'win32' ? realCurrent.toLowerCase() : realCurrent
      if (visitedRealPaths.has(key)) return
      visitedRealPaths.add(key)

      const candidateLaunch = path.join(currentDir, '.vscode', 'launch.json')
      if (fs.existsSync(candidateLaunch)) {
        const rel = normalizeRelFolder(path.relative(resolvedRoot, currentDir))
        foundFolders.push({
          workspaceFolder: currentDir,
          relativeFolder: rel,
          launchJsonPath: candidateLaunch,
        })
      }

      if (depth === maxDepth) return
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(path.join(currentDir, entry.name), depth + 1)
      }
    }

    walk(resolvedRoot, 0)

    foundFolders.sort((a, b) => {
      if (a.relativeFolder === '.' && b.relativeFolder !== '.') return -1
      if (b.relativeFolder === '.' && a.relativeFolder !== '.') return 1
      return a.relativeFolder.localeCompare(b.relativeFolder)
    })

    const files: DiscoveredLaunchFile[] = []
    const rawCompounds: RawCompoundItem[] = []
    const runnableConfigs: LaunchConfigItem[] = []

    for (const item of foundFolders) {
      const parsed = readCachedOrParse(item.launchJsonPath, item.workspaceFolder, item.relativeFolder)
      if (!parsed) continue
      files.push({
        launchJsonPath: item.launchJsonPath,
        workspaceFolder: item.workspaceFolder,
        relativeFolder: item.relativeFolder,
        version: parsed.version,
        configurations: parsed.configurations,
        ...(parsed.error ? { error: parsed.error } : {}),
      })
      for (const cfg of parsed.configurations) {
        if (cfg.runnable) runnableConfigs.push(cfg)
      }
      rawCompounds.push(...parsed.compounds)
    }

    const compounds: LaunchCompoundItem[] = rawCompounds.map((raw) => {
      const configIds: string[] = []
      const seen = new Set<string>()
      const missingTargets: string[] = []
      for (const target of raw.targets) {
        const match = resolveCompoundTarget(target, raw.relativeFolder, runnableConfigs)
        if (!match) {
          missingTargets.push(target.folder ? `${target.folder}/${target.name}` : target.name)
          continue
        }
        if (!seen.has(match.id)) {
          seen.add(match.id)
          configIds.push(match.id)
        }
      }
      return {
        id: raw.id,
        name: raw.name,
        relativeFolder: raw.relativeFolder,
        workspaceFolder: raw.workspaceFolder,
        configIds,
        missingTargets,
        stopAll: raw.stopAll,
        ...(raw.preLaunchTask ? { preLaunchTask: raw.preLaunchTask } : {}),
      }
    })

    return {
      rootDir: resolvedRoot,
      files,
      compounds,
      editors,
    }
  }

  return {
    discover,
    clearCache: () => fileCache.clear(),
  }
}
