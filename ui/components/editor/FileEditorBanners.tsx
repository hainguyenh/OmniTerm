import { AlertTriangle, Info, X } from 'lucide-react'
import type { ReactNode } from 'react'

interface FileEditorBannersProps {
  saveError: string | null
  conflict: 'modified' | 'deleted' | null
  readOnly: boolean
  notice: string | null
  onOverwrite: () => void
  onReload: () => void
  onDismissError: () => void
  onDismissNotice: () => void
}

/**
 * Everything the editor has to tell the user above the text, most urgent first. A failed *save*
 * leaves the user's text untouched below; only a failed *load* replaces the body (see FileEditorTab).
 */
export function FileEditorBanners({
  saveError, conflict, readOnly, notice, onOverwrite, onReload, onDismissError, onDismissNotice,
}: FileEditorBannersProps) {
  return (
    <>
      {conflict && (
        <Banner tone="warning" icon={<AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}>
          <span className="truncate">
            {conflict === 'deleted'
              ? 'This file was deleted on disk.'
              : 'This file changed on disk since it was opened.'}
          </span>
          <span className="ml-auto flex gap-1.5 flex-shrink-0">
            <BannerButton onClick={onOverwrite}>{conflict === 'deleted' ? 'Save anyway' : 'Overwrite'}</BannerButton>
            {conflict === 'modified' && <BannerButton onClick={onReload}>Reload from disk</BannerButton>}
          </span>
        </Banner>
      )}
      {saveError && (
        <Banner tone="error" icon={<AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}>
          <span className="truncate">{saveError}</span>
          <DismissButton onClick={onDismissError} />
        </Banner>
      )}
      {readOnly && (
        <Banner tone="info" icon={<Info className="w-3.5 h-3.5 flex-shrink-0" />}>
          <span className="truncate">This file is read-only on disk.</span>
        </Banner>
      )}
      {notice && (
        <Banner tone="info" icon={<Info className="w-3.5 h-3.5 flex-shrink-0" />}>
          <span className="truncate">{notice}</span>
          <DismissButton onClick={onDismissNotice} />
        </Banner>
      )}
    </>
  )
}

function Banner({ tone, icon, children }: { tone: 'warning' | 'error' | 'info'; icon: ReactNode; children: ReactNode }) {
  return (
    <div className={`file-editor-banner is-${tone}`} role={tone === 'info' ? 'status' : 'alert'}>
      {icon}
      {children}
    </div>
  )
}

function BannerButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="file-editor-banner-button" onClick={onClick}>{children}</button>
  )
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Dismiss" className="ml-auto p-0.5 rounded hover:bg-[var(--theme-hover-bg)]" onClick={onClick}>
      <X className="w-3 h-3" />
    </button>
  )
}
