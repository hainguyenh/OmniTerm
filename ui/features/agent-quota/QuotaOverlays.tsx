import { Info, ShieldAlert, TriangleAlert, X } from 'lucide-react'
import { useEffect } from 'react'

import type { Notice } from './quotaStore'

import { dismissNotice, requestConfirm, useQuota } from './quotaStore'

const NOTICE_TTL_MS = 8000

const LEVEL_STYLE: Record<Notice['level'], { border: string; icon: typeof Info }> = {
  info: { border: 'border-theme-border', icon: Info },
  warning: { border: 'border-theme-warning', icon: TriangleAlert },
  danger: { border: 'border-theme-error', icon: ShieldAlert },
}

function NoticeToast({ notice }: { notice: Notice }) {
  // Danger stays until dismissed: "quota still rising" must not scroll away unread.
  useEffect(() => {
    if (notice.level === 'danger') return
    const timer = setTimeout(() => dismissNotice(notice.id), NOTICE_TTL_MS)
    return () => clearTimeout(timer)
  }, [notice.id, notice.level])
  const { border, icon: Icon } = LEVEL_STYLE[notice.level]
  return (
    <div role={notice.level === 'danger' ? 'alert' : 'status'} className={`flex items-start gap-2 p-2.5 rounded-xl border ${border} bg-theme-popup shadow-xl text-xs text-theme-fg`}>
      <Icon className={`w-3.5 h-3.5 mt-px shrink-0 ${notice.level === 'danger' ? 'text-theme-error' : notice.level === 'warning' ? 'text-theme-warning' : 'text-theme-dim'}`} />
      <span className="flex-1">{notice.message}</span>
      <button type="button" aria-label="Dismiss" className="aq-icon-button" onClick={() => dismissNotice(notice.id)}>
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

export function QuotaNotices() {
  const notices = useQuota((state) => state.notices)
  if (notices.length === 0) return null
  return (
    <div className="fixed right-4 bottom-10 z-[60] w-80 flex flex-col gap-2">
      {notices.map((notice) => <NoticeToast key={notice.id} notice={notice} />)}
    </div>
  )
}

/** The danger-styled confirmation every "turn off suspend" goes through. */
export function DangerConfirmDialog() {
  const confirm = useQuota((state) => state.confirm)
  useEffect(() => {
    if (!confirm) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestConfirm(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm])
  if (!confirm) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div role="alertdialog" aria-modal="true" aria-label={confirm.title} className="w-full max-w-md p-5 rounded-2xl border-2 border-theme-error bg-theme-popup shadow-2xl text-sm text-theme-fg flex flex-col gap-3">
        <div className="flex items-center gap-2 font-bold text-theme-error">
          <ShieldAlert className="w-5 h-5" />
          {confirm.title}
        </div>
        <p className="text-xs leading-relaxed">{confirm.message}</p>
        <div className="flex justify-end gap-2">
          <button type="button" autoFocus onClick={() => requestConfirm(null)} className="px-3 py-1.5 rounded-lg border border-theme-border text-xs hover:border-theme-accent">
            Keep suspend on
          </button>
          <button
            type="button"
            onClick={() => {
              confirm.onConfirm()
              requestConfirm(null)
            }}
            className="px-3 py-1.5 rounded-lg bg-theme-error text-white text-xs font-semibold"
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
