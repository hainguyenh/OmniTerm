import { invoke } from '@tauri-apps/api/core'

/** A folder an OmniTerm test run left in the per-user data folders, as `test_data_cleanup_scan` reports it. */
export interface TestDataFolder {
  path: string
  /** The test process that created it; it has ended. */
  pid: number
  files: number
  bytes: number
}

export interface TestDataRemoval {
  path: string
  freedBytes: number
  error: string | null
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export function parseTestDataFolder(raw: unknown): TestDataFolder | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isText(r.path) || ![r.pid, r.files, r.bytes].every(isCount)) return null
  return { path: r.path, pid: r.pid as number, files: r.files as number, bytes: r.bytes as number }
}

export function parseTestDataRemovals(raw: unknown): TestDataRemoval[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): TestDataRemoval[] => {
    const r = item as Record<string, unknown> | null
    if (!r || !isText(r.path) || !isCount(r.freedBytes)) return []
    return [{ path: r.path, freedBytes: r.freedBytes, error: typeof r.error === 'string' ? r.error : null }]
  })
}

/** The folders a clean-up did not remove, and what it freed. */
export function applyTestDataRemovals(
  folders: readonly TestDataFolder[],
  removals: readonly TestDataRemoval[],
): { left: TestDataFolder[]; removed: number; failed: number; freedBytes: number } {
  const removed = new Set(removals.filter((r) => !r.error).map((r) => r.path))
  return {
    left: folders.filter((folder) => !removed.has(folder.path)),
    removed: removed.size,
    failed: removals.length - removed.size,
    freedBytes: removals.reduce((sum, r) => sum + r.freedBytes, 0),
  }
}

export async function scanTestData(): Promise<TestDataFolder[]> {
  const raw = await invoke<unknown>('test_data_cleanup_scan')
  return Array.isArray(raw) ? raw.flatMap((item) => parseTestDataFolder(item) ?? []) : []
}

export async function removeTestData(paths: readonly string[]): Promise<TestDataRemoval[]> {
  return parseTestDataRemovals(await invoke<unknown>('test_data_cleanup_run', { paths }))
}
