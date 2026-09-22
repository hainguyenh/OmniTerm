import { RotateCw } from 'lucide-react'

interface SessionUnavailableOverlayProps {
  onRestart?: () => void
  onDismiss?: () => void
  message?: string
  actionLabel?: string
}

export default function SessionUnavailableOverlay({
  onRestart,
  onDismiss,
  message = 'Session is no longer available',
  actionLabel = 'Restart terminal',
}: SessionUnavailableOverlayProps) {
  return (
    <div
      data-session-unavailable
      className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
    >
      <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-lg border border-theme-border bg-theme-sidebar px-4 py-3 text-center shadow-lg">
        <span className="max-w-xs text-xs text-theme-dim">{message}</span>
        {onRestart && <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 rounded-md border border-theme-accent bg-theme-sidebar px-3 py-1.5 text-xs font-medium text-theme-fg transition-colors hover:bg-theme-accent/20 hover:text-theme-accent"
        >
          <RotateCw className="h-3.5 w-3.5" />
          {actionLabel}
        </button>}
        {onDismiss && <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-theme-dim underline-offset-2 hover:text-theme-fg hover:underline"
        >
          Dismiss
        </button>}
      </div>
    </div>
  )
}
