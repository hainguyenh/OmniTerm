import { useEffect, useState } from 'react'
import { Eye, X } from 'lucide-react'
import { useEscToClose } from '../../../ui/hooks/useEscToClose'

interface BlurModalProps {
  value: number
  onChange: (value: number) => void
  onClose: () => void
}

const clampBlur = (value: number) => Math.max(0, Math.min(16, Math.round(value)))

export default function BlurModal({ value, onChange, onClose }: BlurModalProps) {
  const [draft, setDraft] = useState(() => clampBlur(value))
  useEffect(() => setDraft(clampBlur(value)), [value])
  useEscToClose(false, onClose, onClose)

  const update = (next: number) => {
    const clamped = clampBlur(next)
    setDraft(clamped)
    onChange(clamped)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="w-full max-w-xs overflow-hidden rounded-2xl border border-theme-border bg-theme-popup shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-theme-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-theme-hover text-theme-accent">
              <Eye className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-theme-fg">Blur inactive windows</h2>
              <p className="text-[10px] text-theme-dim">Keep private work out of view when unfocused.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} title="Close" className="rounded-lg p-1 text-theme-dim hover:bg-theme-hover hover:text-theme-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="inactive-window-blur" className="font-semibold text-theme-fg">Blur strength</label>
            <span className={draft === 0 ? 'text-theme-dim' : 'text-theme-accent'}>{draft === 0 ? 'OFF' : `${draft}px`}</span>
          </div>
          <input
            id="inactive-window-blur"
            type="range"
            min="0"
            max="16"
            step="1"
            value={draft}
            onChange={event => update(Number(event.target.value))}
            className="w-full accent-[var(--theme-accent)]"
            aria-describedby="inactive-window-blur-help"
          />
          <div id="inactive-window-blur-help" className="flex justify-between text-[10px] text-theme-dim">
            <span>Sharp</span>
            <span>Strong</span>
          </div>

          <div data-testid="blur-preview" className="rounded-xl border border-theme-border bg-theme-bg p-3" aria-live="polite">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-theme-dim">Live preview</p>
            <div data-testid="blur-preview-surface" className="rounded-lg border border-theme-accent/40 bg-theme-sidebar p-3 transition-[filter] duration-150" style={{ filter: draft === 0 ? 'none' : `blur(${draft}px)` }}>
              <div className="mb-2 h-1.5 w-1/2 rounded-full bg-theme-accent/70" />
              <div className="space-y-1.5"><div className="h-1 w-full rounded-full bg-theme-dim/50" /><div className="h-1 w-4/5 rounded-full bg-theme-dim/40" /><div className="h-1 w-3/5 rounded-full bg-theme-dim/30" /></div>
            </div>
          </div>

          <div role="status" className="flex items-center justify-between rounded-lg border border-theme-border bg-theme-hover px-3 py-2 text-[11px]">
            <span className="text-theme-dim">Inactive window blur</span>
            <span className={`font-semibold ${draft === 0 ? 'text-theme-dim' : 'text-theme-accent'}`}>{draft === 0 ? 'Off' : 'On'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
