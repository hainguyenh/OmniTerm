import { vi } from 'vitest'
import type { WorkspaceEntry, WorkspaceScript } from '@omniterm/contract'
import { mockOmnitermAPI } from '../../testUtils'

export const WS = { id: 'ws#1', name: 'my-project', folders: [{ id: 'folder#1', name: 'folder#1', path: 'C:/proj' }], order: 0, pins: [] }

export const dir = (id: string): WorkspaceEntry => ({
  id,
  name: id.split('/').pop()!,
  path: id,
  isDir: true,
  kind: 'dir',
})

export const file = (id: string, kind: string, shell?: 'cmd' | 'powershell' | 'wsl'): WorkspaceEntry => ({
  id,
  name: id.split('/').pop()!,
  path: id,
  isDir: false,
  kind,
  ...(shell ? { shell } : {}),
  ...(['bat', 'ps1', 'sh', 'rdp'].includes(kind) ? { editable: kind !== 'rdp' } : {}),
})

export const BAT = file('deploy.bat', 'bat', 'cmd')
export const RDP = file('server.rdp', 'rdp')

export const scriptOf = (entry: WorkspaceEntry): WorkspaceScript => ({
  id: entry.id,
  name: entry.name,
  path: entry.path,
  kind: entry.kind,
  shell: entry.shell,
  editable: entry.editable ?? false,
})

export const page = (entries: unknown[], hasMore = false, total?: number) => ({
  entries,
  total: total ?? entries.length,
  hasMore,
})

export const filterAs = (mode: string) => ({
  mode,
  kinds: [],
  paths: [],
  showEmptyDirs: false,
})

export const mockScan = (
  dirs: WorkspaceEntry[],
  files: WorkspaceEntry[],
  run = vi.fn(async () => true),
) => {
  const scanFolderEntries = vi.fn(async (_id: string, folder: string) => {
    const prefix = folder === '' ? '' : `${folder}/`
    const direct = files.filter((entry) =>
      entry.id.startsWith(prefix) && !entry.id.slice(prefix.length).includes('/'))
    return page(direct)
  })
  mockOmnitermAPI({
    workspace: { list: async () => [WS], scanFolders: async () => dirs, scanFolderEntries, run },
  })
  return scanFolderEntries
}
