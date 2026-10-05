import { FolderPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { WorkspaceDialogError, WorkspaceDialogFooter, WorkspaceDialogFrame } from './WorkspaceDialogFrame'

interface CreateFolderDialogProps {
  parentName: string
  onClose: () => void
  /** Rejects with the reason the folder could not be made; the dialog stays open to show it. */
  onCreate: (name: string) => Promise<void>
}

export function CreateFolderDialog({ parentName, onClose, onCreate }: CreateFolderDialogProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const clean = name.trim()
    if (!clean) return
    if (/[\\/]/.test(clean)) {
      setError('Folder name cannot contain slashes')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate(clean)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <WorkspaceDialogFrame title="Create New Folder" icon={FolderPlus} onClose={onClose}>
      <div className="text-xs text-[var(--theme-dim)] truncate">
        In folder: <span className="font-mono text-[var(--theme-fg)]">{parentName}</span>
      </div>
      <WorkspaceDialogError message={error} />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="create-folder-name" className="text-[11px] text-[var(--theme-dim)] font-medium">
            Folder name
          </label>
          <input
            id="create-folder-name"
            autoFocus
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="new-folder"
            className="w-full px-2 py-1 text-xs bg-[var(--theme-input-bg,var(--theme-bg))] border border-[var(--theme-border)] rounded outline-none focus:border-[var(--theme-accent)] font-mono"
          />
        </div>
        <WorkspaceDialogFooter
          busy={busy}
          canSubmit={Boolean(name.trim())}
          submitLabel="Create"
          busyLabel="Creating…"
          onCancel={onClose}
        />
      </form>
    </WorkspaceDialogFrame>
  )
}
