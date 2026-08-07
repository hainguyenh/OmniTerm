import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Folder, FileText, Link2, Home, ArrowUp, RotateCw, FolderPlus, Upload,
  Eye, EyeOff, Download, Pencil, Trash2, Loader2, X, AlertTriangle,
} from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SftpEntry {
  name: string
  size: number
  mtime: number
  isDir: boolean
  isSymlink: boolean
}

interface FileBrowserProps {
  /** Connection id of the ACTIVE, connected SSH session. */
  id: string
  connectionName: string
  /**
   * Whether the panel is currently shown. When false we keep the component
   * mounted (preserving cwd / entries / scroll state so re-showing is instant)
   * but skip the IPC subscription for async transfer-progress updates, so a
   * collapsed sidebar drives no React state churn for downloads/uploads.
   * Defaults to true so callers that don't care keep the legacy behaviour.
   */
  active?: boolean
}

interface MenuState {
  x: number
  y: number
  entry: SftpEntry
}

type ConfirmState = { entry: SftpEntry } | null

// ── Remote-path helpers (always POSIX) ────────────────────────────────────────

const joinPath = (dir: string, name: string) => (dir.endsWith('/') ? dir + name : dir + '/' + name)
const parentPath = (p: string) => {
  if (p === '/' || !p.includes('/')) return '/'
  const parent = p.slice(0, p.lastIndexOf('/'))
  return parent || '/'
}

// ── Display helpers ───────────────────────────────────────────────────────────

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = -1
  do { v /= 1024; i++ } while (v >= 1024 && i < units.length - 1)
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

function humanDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

/** Strip Electron's "Error invoking remote method 'x': Error:" wrapper for display. */
function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * SFTP browser for the active SSH session. Lives in the left
 * sidebar ("Files" tab). All file operations go through the main process,
 * reusing the already-authenticated ssh2 client.
 */
const FileBrowser: React.FC<FileBrowserProps> = ({ id, connectionName, active = true }) => {
  const [cwd, setCwd] = useState<string>('')
  const [pathInput, setPathInput] = useState<string>('')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [progress, setProgress] = useState<{ kind: string; name: string; transferred: number; total: number } | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ConfirmState>(null)
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null)
  const [newFolder, setNewFolder] = useState<string | null>(null) // null = closed, '' = open empty
  const menuRef = useRef<HTMLDivElement>(null)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  const navigate = useCallback(async (dir: string) => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.omnitermAPI.sftp.list(id, dir)
      setEntries(list)
      setCwd(dir)
      setPathInput(dir)
    } catch (err) {
      setError(cleanError(err))
      setPathInput(cwdRef.current) // revert the path bar to the last good location
    } finally {
      setLoading(false)
    }
  }, [id])

  // Initial load: resolve the remote home dir, then list it.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    window.omnitermAPI.sftp.home(id)
      .then(home => { if (!cancelled) return navigate(home) })
      .catch(err => {
        if (!cancelled) {
          setError(cleanError(err))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [id, navigate])

  // Transfer progress (download/upload), cleared by a null payload from main.
  // Only subscribe while the panel is visible: when the sidebar is collapsed the
  // browser stays mounted for fast re-show (state preserved) but should not drive
  // React state updates from IPC events it cannot have initiated.
  useEffect(() => {
    if (!active) return
    return window.omnitermAPI.sftp.onProgress(id, setProgress)
  }, [id, active])

  // Close the context menu on outside click or Escape (same pattern as Sidebar).
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [menu])

  const refresh = () => navigate(cwd)

  const runOp = async (op: () => Promise<unknown>, andRefresh = true) => {
    setError(null)
    try {
      await op()
      if (andRefresh) await navigate(cwdRef.current)
    } catch (err) {
      setError(cleanError(err))
    }
  }

  const download = (entry: SftpEntry) =>
    runOp(() => window.omnitermAPI.sftp.download(id, joinPath(cwd, entry.name), entry.name), false)

  const upload = () => runOp(() => window.omnitermAPI.sftp.upload(id, cwd))

  const doDelete = (entry: SftpEntry) =>
    runOp(() =>
      entry.isDir && !entry.isSymlink
        ? window.omnitermAPI.sftp.rmdirRecursive(id, joinPath(cwd, entry.name))
        : window.omnitermAPI.sftp.delete(id, joinPath(cwd, entry.name)),
    )

  const doRename = (oldName: string, newName: string) => {
    if (!newName || newName === oldName || newName.includes('/')) {
      setRenaming(null)
      return
    }
    setRenaming(null)
    void runOp(() => window.omnitermAPI.sftp.rename(id, joinPath(cwd, oldName), joinPath(cwd, newName)))
  }

  const doMkdir = (name: string) => {
    setNewFolder(null)
    if (!name || name.includes('/')) return
    void runOp(() => window.omnitermAPI.sftp.mkdir(id, joinPath(cwd, name)))
  }

  const visible = showHidden ? entries : entries.filter(e => !e.name.startsWith('.'))

  const toolBtn = (title: string, onClick: () => void, icon: React.ReactNode, disabled = false) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex-1 flex items-center justify-center py-1.5 rounded-lg text-theme-dim hover:text-theme-accent hover:bg-theme-popup transition-colors disabled:opacity-30 disabled:hover:text-theme-dim disabled:hover:bg-transparent"
    >
      {icon}
    </button>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-theme-bg">
      {/* Session label */}
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-theme-dim truncate">
        {connectionName}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 pb-1.5 border-b border-theme-border">
        {toolBtn('Home directory', () => { void window.omnitermAPI.sftp.home(id).then(navigate).catch(err => setError(cleanError(err))) }, <Home className="w-4 h-4" />)}
        {toolBtn('Up one level', () => void navigate(parentPath(cwd)), <ArrowUp className="w-4 h-4" />, cwd === '/' || !cwd)}
        {toolBtn('Refresh', refresh, <RotateCw className="w-4 h-4" />, !cwd)}
        {toolBtn('New folder', () => setNewFolder(''), <FolderPlus className="w-4 h-4" />, !cwd)}
        {toolBtn('Upload file(s) here', upload, <Upload className="w-4 h-4" />, !cwd)}
        {toolBtn(showHidden ? 'Hide hidden files' : 'Show hidden files', () => setShowHidden(v => !v),
          showHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />)}
      </div>

      {/* Editable path bar */}
      <div className="px-2 py-1.5 border-b border-theme-border">
        <input
          value={pathInput}
          onChange={e => setPathInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void navigate(pathInput.trim() || '/')
            if (e.key === 'Escape') setPathInput(cwd)
          }}
          spellCheck={false}
          placeholder="/"
          className="w-full bg-theme-sidebar border border-theme-border rounded-lg px-2 py-1 text-xs text-theme-fg font-mono focus:outline-none focus:border-theme-accent transition-colors"
          title="Remote path — press Enter to navigate"
        />
      </div>

      {/* Error strip */}
      {error && (
        <div className="flex items-start gap-1.5 px-3 py-1.5 text-[11px] text-theme-error bg-theme-error/10 border-b border-theme-border">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          <span className="min-w-0 break-words">{error}</span>
          <button type="button" onClick={() => setError(null)} className="ml-auto flex-shrink-0 hover:text-white transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Listing */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-theme-dim text-xs">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            {/* Inline "new folder" row */}
            {newFolder !== null && (
              <div className="flex items-center gap-1.5 px-3 py-1">
                <Folder className="w-4 h-4 text-theme-warning flex-shrink-0" />
                <input
                  autoFocus
                  value={newFolder}
                  onChange={e => setNewFolder(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') doMkdir(newFolder.trim())
                    if (e.key === 'Escape') setNewFolder(null)
                  }}
                  onBlur={() => setNewFolder(null)}
                  placeholder="folder name"
                  className="flex-1 min-w-0 bg-theme-sidebar border border-theme-accent rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                />
              </div>
            )}

            {visible.length === 0 && newFolder === null ? (
              <div className="py-8 text-center text-xs text-theme-dim select-none">Empty directory</div>
            ) : (
              visible.map(entry => (
                <div
                  key={entry.name}
                  onDoubleClick={() => (entry.isDir ? void navigate(joinPath(cwd, entry.name)) : void download(entry))}
                  onContextMenu={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    setMenu({ x: e.clientX, y: e.clientY, entry })
                  }}
                  title={`${entry.name}${entry.isDir ? '' : ` — ${humanSize(entry.size)}`} — ${humanDate(entry.mtime)}`}
                  className="group flex items-center gap-1.5 px-3 py-1 cursor-pointer select-none text-theme-fg hover:bg-theme-popup transition-colors"
                >
                  {entry.isSymlink ? (
                    <Link2 className="w-4 h-4 text-[#7dcfff] flex-shrink-0" />
                  ) : entry.isDir ? (
                    <Folder className="w-4 h-4 text-theme-warning flex-shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-theme-dim flex-shrink-0" />
                  )}

                  {renaming?.name === entry.name ? (
                    <input
                      autoFocus
                      value={renaming.value}
                      onChange={e => setRenaming({ name: entry.name, value: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') doRename(entry.name, renaming.value.trim())
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      onBlur={() => setRenaming(null)}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 min-w-0 bg-theme-sidebar border border-theme-accent rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                    />
                  ) : (
                    <>
                      <span className="flex-1 truncate text-xs">{entry.name}</span>
                      {!entry.isDir && (
                        <span className="flex-shrink-0 text-[10px] text-theme-dim tabular-nums">{humanSize(entry.size)}</span>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* Transfer progress */}
      {progress && (
        <div className="px-3 py-1.5 border-t border-theme-border space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-theme-fg">
            {progress.kind === 'download' ? <Download className="w-3 h-3 text-theme-accent" /> : <Upload className="w-3 h-3 text-theme-success" />}
            <span className="truncate flex-1">{progress.name}</span>
            <span className="flex-shrink-0 tabular-nums">
              {progress.total > 0 ? `${Math.round((progress.transferred / progress.total) * 100)}%` : humanSize(progress.transferred)}
            </span>
          </div>
          <div className="h-1 rounded-full bg-theme-popup overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${progress.kind === 'download' ? 'bg-theme-accent' : 'bg-theme-accent'}`}
              style={{ width: progress.total > 0 ? `${(progress.transferred / progress.total) * 100}%` : '100%' }}
            />
          </div>
        </div>
      )}

      {/* Context menu */}
      {menu && (
        <div
          ref={menuRef}
          style={{ top: menu.y, left: menu.x }}
          className="fixed z-50 bg-theme-popup border border-theme-border rounded-xl shadow-2xl py-1 min-w-[140px]"
        >
          {!menu.entry.isDir && (
            <button
              type="button"
              onClick={() => { setMenu(null); void download(menu.entry) }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-theme-fg hover:bg-theme-bg hover:text-white transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-theme-accent" />Download
            </button>
          )}
          <button
            type="button"
            onClick={() => { setMenu(null); setRenaming({ name: menu.entry.name, value: menu.entry.name }) }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-theme-fg hover:bg-theme-bg hover:text-white transition-colors"
          >
            <Pencil className="w-3.5 h-3.5 text-theme-warning" />Rename
          </button>
          <button
            type="button"
            onClick={() => { setMenu(null); setConfirmDelete({ entry: menu.entry }) }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-theme-error hover:bg-theme-bg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />Delete
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <ConfirmDialog
          title={confirmDelete.entry.isDir ? 'Delete folder?' : 'Delete file?'}
          message={
            confirmDelete.entry.isDir && !confirmDelete.entry.isSymlink
              ? `"${confirmDelete.entry.name}" and ALL of its contents will be permanently deleted from ${connectionName}.`
              : `"${confirmDelete.entry.name}" will be permanently deleted from ${connectionName}.`
          }
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={() => { const e = confirmDelete.entry; setConfirmDelete(null); void doDelete(e) }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

export default FileBrowser
