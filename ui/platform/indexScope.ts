import type { Workspace } from '../domain'

/**
 * Which projects of a workspace the workbench index covers. Indexing competes with the terminals
 * for CPU and disk, so nothing is indexed on its own, not even the default project: a workspace
 * indexes exactly the projects the user chose to index in this session (the notification offered
 * when it opens, Index Project on a project, or "yes" when a project that is not indexed becomes
 * the default). The choice is not kept across restarts, so every start asks again.
 */

/** localStorage key of each workspace's default project: `{ [workspaceId]: folderPath }`. */
const DEFAULTS_KEY = 'omniterm.workspace.defaultProjects'
/**
 * localStorage key where earlier builds kept each workspace's indexed projects, which made every
 * start index them without asking. Removed on load.
 */
const LEGACY_INDEXED_KEY = 'omniterm.workspace.indexedProjects'

try {
  globalThis.localStorage?.removeItem(LEGACY_INDEXED_KEY)
} catch {
  // Storage unavailable: there is nothing to clear either.
}

/** The projects each workspace indexes this session: `workspaceId` → folder paths. */
const indexed = new Map<string, string[]>()

function readRecord(key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function writeRecord(key: string, value: Readonly<Record<string, unknown>>): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // The choice then lasts for this window only.
  }
}

/** The stored default project of every workspace. */
export function storedDefaults(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(readRecord(DEFAULTS_KEY)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

export function storeDefaults(defaults: Readonly<Record<string, string>>): void {
  writeRecord(DEFAULTS_KEY, defaults)
}

/** A path as two sources compare it: forward slashes, no trailing one, case-insensitive. */
const comparable = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()

/** The default project of `workspace`: the stored choice while it is switched on, else its first active folder. */
export function defaultFolder(workspace: Workspace): string | null {
  const active = workspace.folders.filter((folder) => !folder.disabled)
  const chosen = storedDefaults()[workspace.id]
  const match = chosen ? active.find((folder) => comparable(folder.path) === comparable(chosen)) : undefined
  return (match ?? active[0])?.path ?? null
}

/** The folders of `workspace` the index covers: none until the user chooses one. */
export function indexedFolders(workspace: Workspace): string[] {
  const wanted = new Set((indexed.get(workspace.id) ?? []).map(comparable))
  return workspace.folders.filter((folder) => wanted.has(comparable(folder.path))).map((folder) => folder.path)
}

export function isIndexed(workspace: Workspace, path: string): boolean {
  return indexedFolders(workspace).some((folder) => comparable(folder) === comparable(path))
}

/** Adds `path` to the indexed projects of `workspace`; false when it already was one. */
export function markIndexed(workspace: Workspace, path: string): boolean {
  const current = indexedFolders(workspace)
  if (current.some((folder) => comparable(folder) === comparable(path))) return false
  indexed.set(workspace.id, [...current, path])
  return true
}
