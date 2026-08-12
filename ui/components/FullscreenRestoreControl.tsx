import { Minimize2 } from 'lucide-react'

interface FullscreenRestoreControlProps {
  sessionName?: string
  onRestore: () => void
}

export default function FullscreenRestoreControl({ sessionName, onRestore }: FullscreenRestoreControlProps) {
  return (
    <button
      type="button"
      onClick={onRestore}
      className="absolute right-3 top-3 z-40 flex items-center gap-1.5 rounded-md border border-theme-border bg-theme-popup/95 px-2.5 py-1.5 text-xs text-theme-fg shadow-lg backdrop-blur hover:bg-theme-hover"
      aria-label="Restore view mode"
      title="Restore view mode (Escape)"
    >
      <Minimize2 className="h-3.5 w-3.5" />
      <span>Restore view{sessionName ? ` · ${sessionName}` : ''}</span>
    </button>
  )
}
