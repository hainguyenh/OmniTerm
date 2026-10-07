import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileCode, FileText, Loader2, Search, X } from 'lucide-react'
import type { Workspace, WorkspaceEntry, WorkspaceScript } from '@omniterm/contract'

export interface ProjectSearchModalProps {
  isOpen: boolean
  onClose: () => void
  workspaces: Workspace[]
  activeWorkspaceId?: string | null
  onOpenScript: (workspaceId: string, script: WorkspaceScript) => void
}

interface SearchFileItem {
  id: string
  name: string
  path: string
  kind: string
  workspaceId: string
  workspaceName: string
  viewable?: boolean
  editable?: boolean
  shell?: WorkspaceScript['shell']
}

function scoreFile(file: SearchFileItem, q: string): number {
  const name = file.name.toLowerCase()
  const path = file.path.toLowerCase()
  if (name === q) return 1000
  if (name.startsWith(q)) return 800 - name.length
  if (name.includes(q)) return 500 - name.indexOf(q)
  if (path.includes(q)) return 200 - path.indexOf(q)
  return 0
}

function fileIcon(kind: string) {
  switch (kind.toLowerCase()) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'rs':
    case 'py':
    case 'go':
    case 'java':
    case 'c':
    case 'cpp':
    case 'bat':
    case 'sh':
    case 'ps1':
      return <FileCode className="w-4 h-4 flex-shrink-0 text-[var(--theme-accent)]" />
    default:
      return <FileText className="w-4 h-4 flex-shrink-0 text-[var(--theme-dim)]" />
  }
}

export const ProjectSearchModal: React.FC<ProjectSearchModalProps> = ({
  isOpen,
  onClose,
  workspaces,
  activeWorkspaceId,
  onOpenScript,
}) => {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [files, setFiles] = useState<SearchFileItem[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const currentWorkspace = useMemo(() => {
    if (activeWorkspaceId) {
      const match = workspaces.find((w) => w.id === activeWorkspaceId)
      if (match) return match
    }
    return workspaces[0] ?? null
  }, [workspaces, activeWorkspaceId])

  const loadWorkspaceFiles = useCallback(async (ws: Workspace) => {
    setLoading(true)
    try {
      const collected: SearchFileItem[] = []
      const seen = new Set<string>()

      // 1. Fetch runnable scripts
      try {
        const scripts = (await window.omnitermAPI.workspace.scanScripts(ws.id)) as WorkspaceScript[]
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
            })
          }
        }
      } catch {
        // Fallback or ignore
      }

      // 2. Fetch skeleton folders and their first page entries
      try {
        const dirs = (await window.omnitermAPI.workspace.scanFolders(ws.id)) as WorkspaceEntry[]
        const nonDeferred = dirs.filter((d) => !d.deferred).map((d) => d.id)
        const targetFolders = ['', ...nonDeferred.slice(0, 30)]

        const pages = await Promise.all(
          targetFolders.map((f) =>
            window.omnitermAPI.workspace.scanFolderEntries(ws.id, f, 0, 500).catch(() => null),
          ),
        )

        for (const page of pages) {
          if (!page || !page.entries) continue
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
              })
            }
          }
        }
      } catch {
        // Ignore
      }

      setFiles(collected)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen && currentWorkspace) {
      setQuery('')
      setSelectedIndex(0)
      void loadWorkspaceFiles(currentWorkspace)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen, currentWorkspace, loadWorkspaceFiles])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return files.slice(0, 40)

    return files
      .map((f) => ({ item: f, score: scoreFile(f, q) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((entry) => entry.item)
  }, [files, query])

  const openFile = useCallback(
    (file: SearchFileItem) => {
      const script: WorkspaceScript = {
        id: file.id,
        name: file.name,
        path: file.path,
        kind: file.kind,
        editable: file.editable,
        viewable: file.viewable ?? true,
        shell: file.shell,
      }
      onOpenScript(file.workspaceId, script)
      onClose()
    },
    [onOpenScript, onClose],
  )

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown' && filtered.length > 0) {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filtered.length)
      } else if (e.key === 'ArrowUp' && filtered.length > 0) {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault()
        const selected = filtered[selectedIndex]
        if (selected) openFile(selected)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filtered, selectedIndex, onClose, openFile])

  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const el = listRef.current.children[selectedIndex] as HTMLElement
      el?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Search Everywhere in Project"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[var(--theme-popup-bg)] border border-[var(--theme-border)] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--theme-border)] bg-[var(--theme-sidebar-bg)]">
          <Search className="w-5 h-5 text-[var(--theme-dim)] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-[var(--theme-fg)] outline-none placeholder:text-[var(--theme-dim)] text-sm"
            placeholder="Search Everywhere: type file name or path…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {currentWorkspace && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--theme-border)] text-[var(--theme-dim)] flex-shrink-0">
              {currentWorkspace.name}
            </span>
          )}
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--theme-border)] text-[var(--theme-dim)] hidden sm:inline-block">
            Shift Shift
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
            aria-label="Close search"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results list */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 min-h-[200px] max-h-[55vh]">
          {loading && files.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-xs text-[var(--theme-dim)]">
              <Loader2 className="w-4 h-4 animate-spin mr-2 text-[var(--theme-accent)]" />
              Indexing project files…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--theme-dim)]">
              {query ? `No files matching "${query}"` : 'No files found in project'}
            </div>
          ) : (
            filtered.map((file, index) => {
              const isSelected = index === selectedIndex
              return (
                <div
                  key={`${file.workspaceId}:${file.path}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => openFile(file)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors text-xs ${
                    isSelected
                      ? 'bg-[var(--theme-selection)] text-[var(--theme-selection-fg,var(--theme-fg))] font-medium'
                      : 'text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]'
                  }`}
                >
                  {fileIcon(file.kind)}
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                    <span className="font-semibold truncate">{file.name}</span>
                    <span className="text-[11px] text-[var(--theme-dim)] truncate max-w-[50%]">
                      {file.path}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="text-[10px] font-mono text-[var(--theme-dim)] flex-shrink-0">
                      ↵ Open
                    </span>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--theme-border)] bg-[var(--theme-sidebar-bg)] text-[10px] text-[var(--theme-dim)] select-none">
          <div className="flex items-center gap-3">
            <span>↑↓ to navigate</span>
            <span>↵ to open</span>
            <span>esc to close</span>
          </div>
          <span>{files.length} project files</span>
        </div>
      </div>
    </div>
  )
}
