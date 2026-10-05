import { FilePlus, X } from 'lucide-react'
import React, { useState } from 'react'

interface CreateFileDialogProps {
  workspaceId: string
  folderPath: string
  folderName?: string
  onClose: () => void
  onCreated: (filePath: string, fileName: string) => void
}

export const CreateFileDialog: React.FC<CreateFileDialogProps> = ({
  workspaceId,
  folderPath,
  folderName,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('')
  const [ext, setExt] = useState('txt')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanName = name.trim()
    const cleanExt = ext.trim().replace(/^\./, '')
    if (!cleanName) {
      setError('File name cannot be empty')
      return
    }
    if (cleanName.includes('/') || cleanName.includes('\\')) {
      setError('File name cannot contain slashes')
      return
    }

    const fullFileName = cleanExt ? `${cleanName}.${cleanExt}` : cleanName
    const relativePath = folderPath ? `${folderPath}/${fullFileName}` : fullFileName

    setBusy(true)
    setError(null)
    try {
      const createdPath = await window.omnitermAPI.workspace.createTextFile(workspaceId, relativePath)
      onCreated(createdPath, fullFileName)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-fg)] shadow-2xl p-4 flex flex-col gap-3"
        role="dialog"
        aria-modal="true"
        aria-label="Create new file"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium text-sm">
            <FilePlus className="w-4 h-4 text-[var(--theme-accent)]" />
            <span>Create New File</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-[var(--theme-dim)] truncate">
          In folder: <span className="font-mono text-[var(--theme-fg)]">{folderName || folderPath || 'root'}</span>
        </div>

        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 flex flex-col gap-1">
              <label htmlFor="create-file-name" className="text-[11px] text-[var(--theme-dim)] font-medium">
                File name
              </label>
              <input
                id="create-file-name"
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="filename"
                className="w-full px-2 py-1 text-xs bg-[var(--theme-input-bg,var(--theme-bg))] border border-[var(--theme-border)] rounded outline-none focus:border-[var(--theme-accent)] font-mono"
              />
            </div>
            <span className="self-end pb-1 text-sm font-bold text-[var(--theme-dim)]">.</span>
            <div className="w-20 flex flex-col gap-1">
              <label htmlFor="create-file-ext" className="text-[11px] text-[var(--theme-dim)] font-medium">
                Ext
              </label>
              <input
                id="create-file-ext"
                type="text"
                value={ext}
                onChange={(e) => setExt(e.target.value)}
                placeholder="txt"
                className="w-full px-2 py-1 text-xs bg-[var(--theme-input-bg,var(--theme-bg))] border border-[var(--theme-border)] rounded outline-none focus:border-[var(--theme-accent)] font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1 rounded text-xs text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="px-3 py-1 rounded text-xs font-medium bg-[var(--theme-accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
