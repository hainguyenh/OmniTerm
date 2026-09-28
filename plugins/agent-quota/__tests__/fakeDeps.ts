import path from 'node:path'
import { vi } from 'vitest'

import type { CliResult } from '../src/cli'
import type { ProviderDeps } from '../src/deps'

export const HOME = path.join(path.sep === '\\' ? 'C:\\' : '/', 'home', 'me')
export const NOW = Date.UTC(2026, 8, 25, 3, 0)

export function cliResult(overrides: Partial<CliResult> = {}): CliResult {
  return { code: 0, stdout: '', stderr: '', timedOut: false, ...overrides }
}

/** In-memory deps: files by absolute path, directories derived from them. */
export function fakeDeps(files: Record<string, string> = {}, overrides: Partial<ProviderDeps> = {}): ProviderDeps {
  const listDir = async (dir: string) => {
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep
    const names = new Set<string>()
    for (const file of Object.keys(files)) {
      if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split(path.sep)[0])
    }
    return [...names]
  }
  return {
    run: vi.fn(async () => cliResult()),
    readTail: async (file, bytes) => (files[file] === undefined ? null : files[file].slice(-bytes)),
    listDir,
    mtime: async (file) => (files[file] === undefined ? null : NOW),
    resolve: () => null,
    resolveLauncher: () => null,
    home: HOME,
    tmp: path.join(HOME, 'tmp'),
    env: { PATH: '' },
    now: () => NOW,
    log: vi.fn(),
    ...overrides,
  }
}
