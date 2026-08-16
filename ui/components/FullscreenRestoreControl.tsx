import { Minimize2 } from 'lucide-react'
import { Button } from './Button'

interface FullscreenRestoreControlProps {
  sessionName?: string
  onRestore: () => void
}

export default function FullscreenRestoreControl({ sessionName, onRestore }: FullscreenRestoreControlProps) {
  return (
    <Button
      onClick={onRestore}
      icon={<Minimize2 className="h-3.5 w-3.5" />}
      tooltip="Restore view mode (Escape)"
      tooltipPlacement="bottom"
      className="absolute right-3 top-3 z-40 bg-theme-popup/95 backdrop-blur shadow-lg hover:bg-theme-hover"
      aria-label="Restore view mode"
      size="sm"
    >
      <span>Restore view{sessionName ? ` · ${sessionName}` : ''}</span>
    </Button>
  )
}
