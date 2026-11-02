import type {
  LaunchConfigItem,
  ParsedLaunchFile,
  RawCompoundItem,
  RawCompoundTarget,
} from './types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  return value
    .filter(
      (entry): entry is string | number | boolean =>
        typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean',
    )
    .map(String)
}

const asEnvRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, rawVal] of Object.entries(value)) {
    if (rawVal === null || rawVal === undefined) continue
    if (typeof rawVal === 'string' || typeof rawVal === 'number' || typeof rawVal === 'boolean') {
      out[key] = String(rawVal)
    }
  }
  return out
}

/**
 * Strip `//` line comments, `/* ... *\/` block comments, and trailing commas before `}` or `]`
 * while preserving everything inside JSON string literals.
 */
export function stripJsonc(source: string): string {
  const withoutComments: string[] = []
  let inString = false
  let index = 0
  const cleanSource = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source

  while (index < cleanSource.length) {
    const ch = cleanSource[index]
    const next = cleanSource[index + 1]

    if (inString) {
      withoutComments.push(ch)
      if (ch === '\\' && index + 1 < cleanSource.length) {
        withoutComments.push(cleanSource[index + 1])
        index += 2
        continue
      }
      if (ch === '"') inString = false
      index += 1
      continue
    }

    if (ch === '"') {
      inString = true
      withoutComments.push(ch)
      index += 1
      continue
    }

    if (ch === '/' && next === '/') {
      index += 2
      while (index < cleanSource.length && cleanSource[index] !== '\n') index += 1
      continue
    }

    if (ch === '/' && next === '*') {
      index += 2
      while (index < cleanSource.length && !(cleanSource[index] === '*' && cleanSource[index + 1] === '/')) {
        if (cleanSource[index] === '\n') withoutComments.push('\n')
        index += 1
      }
      index += 2
      continue
    }

    withoutComments.push(ch)
    index += 1
  }

  const joined = withoutComments.join('')
  const result: string[] = []
  let str = false
  for (let pos = 0; pos < joined.length; pos += 1) {
    const ch = joined[pos]
    if (str) {
      result.push(ch)
      if (ch === '\\' && pos + 1 < joined.length) {
        result.push(joined[pos + 1])
        pos += 1
        continue
      }
      if (ch === '"') str = false
      continue
    }
    if (ch === '"') {
      str = true
      result.push(ch)
      continue
    }
    if (ch === ',') {
      let lookahead = pos + 1
      while (lookahead < joined.length && /\s/.test(joined[lookahead])) lookahead += 1
      const token = joined[lookahead]
      if (token === '}' || token === ']') continue
    }
    result.push(ch)
  }
  return result.join('')
}

/** Accept VS Code launch.json versions >= 0.2.0 (`major > 0` or `major === 0 && minor >= 2`). */
export function isSupportedLaunchVersion(version: unknown): boolean {
  if (typeof version !== 'string') return false
  const match = version.trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false
  return major > 0 || (major === 0 && minor >= 2)
}

function parseConfigEntry(
  raw: unknown,
  workspaceFolder: string,
  relativeFolder: string,
  seenNames: Map<string, number>,
): LaunchConfigItem | null {
  if (!isRecord(raw)) return null
  const name = asString(raw.name)
  const type = asString(raw.type)
  const request = asString(raw.request) ?? 'launch'
  if (!name || !type) return null

  const occurrence = (seenNames.get(name) ?? 0) + 1
  seenNames.set(name, occurrence)
  const id = occurrence > 1 ? `${relativeFolder}::${name}#${occurrence}` : `${relativeFolder}::${name}`

  const program = asString(raw.program)
  const runtimeExecutable = asString(raw.runtimeExecutable)
  const runtimeArgs = asStringArray(raw.runtimeArgs)
  const args = asStringArray(raw.args)
  const cwd = asString(raw.cwd)
  const env = asEnvRecord(raw.env)
  const envFile = asString(raw.envFile)
  const moduleName = asString(raw.module)
  const pythonExec = asString(raw.python) ?? asString(raw.pythonPath)
  const projectPath = asString(raw.projectPath) ?? asString(raw.project)
  const cargoBlock = isRecord(raw.cargo) ? asStringArray(raw.cargo.args) : undefined
  const preLaunchTask = asString(raw.preLaunchTask)
  const stopOnEntry = raw.stopOnEntry === true || raw.stopAtEntry === true
  const consoleKind = asString(raw.console)
  const port = typeof raw.port === 'number' && Number.isFinite(raw.port) ? raw.port : undefined
  const processId = typeof raw.processId === 'number' || typeof raw.processId === 'string' ? raw.processId : undefined
  const url = asString(raw.url)

  return {
    id,
    name,
    type,
    request,
    runnable: request === 'launch' || request === 'attach',
    workspaceFolder,
    relativeFolder,
    ...(program ? { program } : {}),
    ...(runtimeExecutable ? { runtimeExecutable } : {}),
    ...(runtimeArgs ? { runtimeArgs } : {}),
    ...(args ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
    ...(envFile ? { envFile } : {}),
    ...(moduleName ? { module: moduleName } : {}),
    ...(pythonExec ? { python: pythonExec } : {}),
    ...(projectPath ? { projectPath } : {}),
    ...(cargoBlock && cargoBlock.length > 0 ? { cargoArgs: cargoBlock } : {}),
    ...(preLaunchTask ? { preLaunchTask } : {}),
    ...(stopOnEntry ? { stopOnEntry: true } : {}),
    ...(consoleKind ? { console: consoleKind } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(processId !== undefined ? { processId } : {}),
    ...(url ? { url } : {}),
  }
}

function parseCompoundEntry(
  raw: unknown,
  workspaceFolder: string,
  relativeFolder: string,
): RawCompoundItem | null {
  if (!isRecord(raw)) return null
  const name = asString(raw.name)
  if (!name || !Array.isArray(raw.configurations)) return null

  const targets: RawCompoundTarget[] = []
  for (const item of raw.configurations) {
    if (typeof item === 'string' && item.trim().length > 0) {
      targets.push({ name: item })
    } else if (isRecord(item) && typeof item.name === 'string' && item.name.trim().length > 0) {
      targets.push({
        name: item.name,
        ...(typeof item.folder === 'string' && item.folder.trim().length > 0 ? { folder: item.folder } : {}),
      })
    }
  }
  if (targets.length === 0) return null

  const preLaunchTask = asString(raw.preLaunchTask)
  return {
    id: `${relativeFolder}::compound::${name}`,
    name,
    relativeFolder,
    workspaceFolder,
    targets,
    stopAll: raw.stopAll === true,
    ...(preLaunchTask ? { preLaunchTask } : {}),
  }
}

export function parseLaunchJsonText(
  raw: string,
  workspaceFolder: string,
  relativeFolder: string,
): ParsedLaunchFile {
  let decoded: unknown
  try {
    decoded = JSON.parse(stripJsonc(raw))
  } catch (err) {
    return {
      version: '',
      workspaceFolder,
      relativeFolder,
      configurations: [],
      compounds: [],
      error: `Invalid JSONC in launch.json: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (!isRecord(decoded)) {
    return {
      version: '',
      workspaceFolder,
      relativeFolder,
      configurations: [],
      compounds: [],
      error: 'launch.json root must be an object',
    }
  }

  const version = typeof decoded.version === 'string' ? decoded.version : ''
  if (!isSupportedLaunchVersion(version)) {
    return {
      version,
      workspaceFolder,
      relativeFolder,
      configurations: [],
      compounds: [],
      error: `Unsupported launch.json version "${version || 'missing'}" (requires >= 0.2.0)`,
    }
  }

  const seenNames = new Map<string, number>()
  const configurations = Array.isArray(decoded.configurations)
    ? decoded.configurations
        .map((entry) => parseConfigEntry(entry, workspaceFolder, relativeFolder, seenNames))
        .filter((entry): entry is LaunchConfigItem => entry !== null)
    : []

  const compounds = Array.isArray(decoded.compounds)
    ? decoded.compounds
        .map((entry) => parseCompoundEntry(entry, workspaceFolder, relativeFolder))
        .filter((entry): entry is RawCompoundItem => entry !== null)
    : []

  return {
    version,
    workspaceFolder,
    relativeFolder,
    configurations,
    compounds,
  }
}
