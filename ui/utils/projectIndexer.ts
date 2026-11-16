import type { Workspace, WorkspaceEntry, WorkspaceScript } from '../domain'

export interface IndexedFile {
  id: string
  name: string
  path: string
  kind: string
  workspaceId: string
  workspaceName: string
  viewable?: boolean
  editable?: boolean
  shell?: WorkspaceScript['shell']
  searchTokens: string
}

export interface WorkspaceIndex {
  workspaceId: string
  indexedAt: number
  files: IndexedFile[]
  pathMap: Map<string, IndexedFile>
}

const workspaceIndexCache = new Map<string, WorkspaceIndex>()

const INDEX_TTL_MS = 60_000

export function scoreIndexedFile(file: IndexedFile, q: string): number {
  const name = file.name.toLowerCase()
  const path = file.path.toLowerCase()
  if (name === q) return 1000
  if (name.startsWith(q)) return 800 - name.length
  if (name.includes(q)) return 500 - name.indexOf(q)
  if (path.includes(q)) return 200 - path.indexOf(q)
  return 0
}

export async function indexWorkspaceFiles(ws: Workspace): Promise<IndexedFile[]> {
  const collected: IndexedFile[] = []
  const seen = new Set<string>()

  try {
    const scripts = (await window.omnitermAPI?.workspace?.scanScripts?.(ws.id)) as WorkspaceScript[] | undefined
    if (Array.isArray(scripts)) {
      for (const s of scripts) {
        if (!seen.has(s.path)) {
          seen.add(s.path)
          collected.push({
            id: s.id,
            name: s.name,
            path: s.path,
            kind: s.kind,
            workspaceId: ws.id,
            workspaceName: ws.name,
            viewable: s.viewable ?? true,
            editable: s.editable,
            shell: s.shell,
            searchTokens: `${s.name.toLowerCase()} ${s.path.toLowerCase()}`,
          })
        }
      }
    }
  } catch {
    // script scan fallback
  }

  try {
    const dirs = (await window.omnitermAPI?.workspace?.scanFolders?.(ws.id)) as WorkspaceEntry[] | undefined
    if (Array.isArray(dirs)) {
      const nonDeferred = dirs.filter((d) => !d.deferred).map((d) => d.id)
      const targetFolders = ['', ...nonDeferred.slice(0, 40)]

      const pages = await Promise.all(
        targetFolders.map((f) =>
          window.omnitermAPI?.workspace?.scanFolderEntries?.(ws.id, f, 0, 500).catch(() => null),
        ),
      )

      for (const page of pages) {
        if (!page?.entries) continue
        for (const e of page.entries) {
          if (!e.isDir && !seen.has(e.path)) {
            seen.add(e.path)
            collected.push({
              id: e.id,
              name: e.name,
              path: e.path,
              kind: e.kind,
              workspaceId: ws.id,
              workspaceName: ws.name,
              viewable: e.viewable ?? true,
              editable: e.editable,
              shell: e.shell,
              searchTokens: `${e.name.toLowerCase()} ${e.path.toLowerCase()}`,
            })
          }
        }
      }
    }
  } catch {
    // folder scan fallback
  }

  const pathMap = new Map<string, IndexedFile>()
  for (const f of collected) {
    pathMap.set(f.path, f)
  }

  workspaceIndexCache.set(ws.id, {
    workspaceId: ws.id,
    indexedAt: Date.now(),
    files: collected,
    pathMap,
  })

  return collected
}

export async function getOrIndexWorkspace(ws: Workspace, force = false): Promise<IndexedFile[]> {
  const existing = workspaceIndexCache.get(ws.id)
  if (!force && existing && Date.now() - existing.indexedAt < INDEX_TTL_MS) {
    return existing.files
  }
  return indexWorkspaceFiles(ws)
}

export function searchIndexedFiles(workspaceId: string, query: string, limit = 50): IndexedFile[] {
  const cached = workspaceIndexCache.get(workspaceId)
  if (!cached) return []
  const q = query.trim().toLowerCase()
  if (!q) return cached.files.slice(0, limit)

  return cached.files
    .filter((f) => f.searchTokens.includes(q))
    .map((f) => ({ item: f, score: scoreIndexedFile(f, q) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item)
}

export function invalidateProjectIndex(workspaceId: string): void {
  workspaceIndexCache.delete(workspaceId)
}
