/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import {
  getOrIndexWorkspace,
  indexWorkspaceFiles,
  invalidateProjectIndex,
  scoreIndexedFile,
  searchIndexedFiles,
  type IndexedFile,
} from '../projectIndexer'

const ws = { id: 'ws-idx', name: 'Main', folders: [], order: 0, pins: [] } as never

const script = (over: Record<string, unknown> = {}) => ({
  id: 'sc1', name: 'Build.sh', path: 'scripts/Build.sh', kind: 'script', shell: 'bash', editable: true, ...over,
})
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1', name: 'Readme.md', path: 'Readme.md', kind: 'md', isDir: false, ...over,
})

function bridge(parts: {
  scripts?: unknown
  dirs?: unknown
  entries?: (folder: string) => unknown
  scriptsThrow?: boolean
  dirsThrow?: boolean
}) {
  const scanFolderEntries = vi.fn((_id: string, folder: string) => {
    const result = parts.entries ? parts.entries(folder) : null
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  })
  window.omnitermAPI = {
    ...window.omnitermAPI,
    workspace: {
      scanScripts: parts.scriptsThrow ? vi.fn().mockRejectedValue(new Error('x')) : vi.fn().mockResolvedValue(parts.scripts),
      scanFolders: parts.dirsThrow ? vi.fn().mockRejectedValue(new Error('x')) : vi.fn().mockResolvedValue(parts.dirs),
      scanFolderEntries,
    },
  } as never
  return scanFolderEntries
}

describe('indexWorkspaceFiles', () => {
  beforeEach(() => invalidateProjectIndex('ws-idx'))
  afterEach(() => vi.useRealTimers())

  it('collects scripts and files, de-duplicating by path', async () => {
    const scan = bridge({
      scripts: [script(), script({ id: 'dup' })],
      dirs: [{ id: 'src' }, { id: 'later', deferred: true }],
      entries: (folder) => ({
        entries: folder === ''
          ? [entry(), entry({ id: 'e2', name: 'Build.sh', path: 'scripts/Build.sh' }), entry({ id: 'd', path: 'dir', isDir: true })]
          : [entry({ id: 'e3', name: 'Main.ts', path: 'src/Main.ts', kind: 'ts', viewable: false, editable: true, shell: 'sh' })],
      }),
    })
    const files = await indexWorkspaceFiles(ws)
    expect(files.map((f) => f.path)).toEqual(['scripts/Build.sh', 'Readme.md', 'src/Main.ts'])
    expect(scan.mock.calls.map((call) => call[1])).toEqual(['', 'src'])
    expect(files[0]).toMatchObject({ viewable: true, shell: 'bash', searchTokens: 'build.sh scripts/build.sh', workspaceName: 'Main' })
    expect(files[2]).toMatchObject({ viewable: false, editable: true, shell: 'sh' })
    expect(searchIndexedFiles('ws-idx', '')).toHaveLength(3)
  })

  it('caps the scanned folders at forty', async () => {
    const scan = bridge({
      scripts: [],
      dirs: Array.from({ length: 60 }, (_, i) => ({ id: `f${i}` })),
      entries: () => ({ entries: [] }),
    })
    await indexWorkspaceFiles(ws)
    expect(scan).toHaveBeenCalledTimes(41)
  })

  it('tolerates failing scans and malformed answers', async () => {
    bridge({ scriptsThrow: true, dirsThrow: true })
    await expect(indexWorkspaceFiles(ws)).resolves.toEqual([])
    bridge({ scripts: 'nope', dirs: 'nope' })
    await expect(indexWorkspaceFiles(ws)).resolves.toEqual([])
    bridge({ scripts: [], dirs: [], entries: () => new Error('page failed') })
    await expect(indexWorkspaceFiles(ws)).resolves.toEqual([])
    bridge({ scripts: [], dirs: [], entries: () => ({}) })
    await expect(indexWorkspaceFiles(ws)).resolves.toEqual([])
  })

  it('works without a bridge at all', async () => {
    window.omnitermAPI = undefined as never
    await expect(indexWorkspaceFiles(ws)).resolves.toEqual([])
    window.omnitermAPI = { workspace: undefined } as never
    await expect(indexWorkspaceFiles(ws)).resolves.toEqual([])
  })

  it('reuses a fresh index and rebuilds a stale or forced one', async () => {
    vi.useFakeTimers()
    bridge({ scripts: [script()], dirs: [], entries: () => ({ entries: [] }) })
    const first = await getOrIndexWorkspace(ws)
    expect(await getOrIndexWorkspace(ws)).toBe(first)
    expect(await getOrIndexWorkspace(ws, true)).not.toBe(first)
    const second = await getOrIndexWorkspace(ws)
    vi.advanceTimersByTime(60_001)
    expect(await getOrIndexWorkspace(ws)).not.toBe(second)
  })
})

describe('searchIndexedFiles ranking', () => {
  beforeEach(async () => {
    invalidateProjectIndex('ws-idx')
    bridge({
      scripts: [],
      dirs: [],
      entries: () => ({
        entries: [
          entry({ id: '1', name: 'app.ts', path: 'src/app.ts' }),
          entry({ id: '2', name: 'app', path: 'bin/app' }),
          entry({ id: '3', name: 'webapp.ts', path: 'web/webapp.ts' }),
          entry({ id: '4', name: 'main.ts', path: 'app/main.ts' }),
        ],
      }),
    })
    await indexWorkspaceFiles(ws)
  })

  it('ranks an exact name, then a prefix, a substring and a path match', () => {
    expect(searchIndexedFiles('ws-idx', ' APP ').map((f) => f.id)).toEqual(['2', '1', '3', '4'])
    expect(searchIndexedFiles('ws-idx', 'app', 2)).toHaveLength(2)
    expect(searchIndexedFiles('ws-idx', 'zzz')).toEqual([])
    expect(searchIndexedFiles('missing', 'app')).toEqual([])
  })

  it('scores every tier', () => {
    const file = { name: 'Name.ts', path: 'dir/Name.ts' } as IndexedFile
    expect(scoreIndexedFile(file, 'name.ts')).toBe(1000)
    expect(scoreIndexedFile(file, 'nam')).toBe(800 - 7)
    expect(scoreIndexedFile(file, 'me.')).toBe(500 - 2)
    expect(scoreIndexedFile(file, 'dir')).toBe(200)
    expect(scoreIndexedFile(file, 'zz')).toBe(0)
  })
})
