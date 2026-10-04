interface PreviewMessageProps {
  text: string
  onAction?: () => void
  actionLabel?: string
}

/** A centered note in place of a preview (failed, too large, waiting for a click) with an optional
 *  action button. */
export function PreviewMessage({ text, onAction, actionLabel = 'Retry' }: PreviewMessageProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center text-xs text-[var(--theme-dim)]">
      <span className="max-w-sm">{text}</span>
      {onAction && (
        <button type="button" className="file-editor-banner-button" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  )
}
