import { useEffect, useState } from 'react'
import { Eye, X } from 'lucide-react'
import { useEscToClose } from '../../../ui/hooks/useEscToClose'
import ToggleRow from '../../../ui/components/ToggleRow'

interface BlurModalProps {
  strength: number
  blurDock: boolean
  enabled: boolean
  onSave: (strength: number, blurDock: boolean, enabled: boolean) => void
  onClose: () => void
}

const clampBlur = (value: number) => Math.max(0, Math.min(16, Math.round(value)))

export default function BlurModal({ strength, blurDock, enabled, onSave, onClose }: BlurModalProps) {
  const [draftStrength, setDraftStrength] = useState(() => clampBlur(strength))
  const [draftDock, setDraftDock] = useState(blurDock)
  const [draftEnabled, setDraftEnabled] = useState(enabled)
  useEffect(() => setDraftStrength(clampBlur(strength)), [strength])
  useEffect(() => setDraftDock(blurDock), [blurDock])
  useEffect(() => setDraftEnabled(enabled), [enabled])
  useEscToClose(false, onClose, onClose)

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

        <div className="space-y-4 px-4 py-4">
          <ToggleRow
            label="Enable Blur"
            description="Toggle the blur effect for inactive windows."
            checked={draftEnabled}
            onChange={() => setDraftEnabled(prev => !prev)}
            ariaLabel="Enable Blur"
          />
          
          <div className={!draftEnabled ? 'opacity-50 pointer-events-none' : ''}>
            <ToggleRow
              label="Blur inactive docks"
              description="Blur individual panes that are not focused."
              checked={draftDock}
              onChange={() => setDraftDock(prev => !prev)}
              ariaLabel="Blur inactive docks"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="inactive-window-blur" className="font-semibold text-theme-fg">Blur strength</label>
              <span className={!draftEnabled || draftStrength === 0 ? 'text-theme-dim' : 'text-theme-accent'}>{draftStrength}px</span>
            </div>
            <input
              id="inactive-window-blur"
              type="range"
              min="0"
              max="16"
              step="1"
              value={draftStrength}
              disabled={!draftEnabled}
              onChange={event => setDraftStrength(Number(event.target.value))}
              className="w-full accent-[var(--theme-accent)]"
              aria-describedby="inactive-window-blur-help"
            />
            <div id="inactive-window-blur-help" className="flex justify-between text-[10px] text-theme-dim">
              <span>Sharp</span>
              <span>Strong</span>
            </div>
          </div>

          <div data-testid="blur-preview" className="rounded-xl border border-theme-border bg-theme-bg p-3" aria-live="polite">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-theme-dim">Live preview</p>
            <div data-testid="blur-preview-surface" className="rounded-lg border border-theme-accent/40 bg-theme-sidebar p-3 transition-[filter] duration-150" style={{ filter: !draftEnabled || draftStrength === 0 ? 'none' : `blur(${draftStrength}px)` }}>
              <div className="mb-2 h-1.5 w-1/2 rounded-full bg-theme-accent/70" />
              <div className="space-y-1.5"><div className="h-1 w-full rounded-full bg-theme-dim/50" /><div className="h-1 w-4/5 rounded-full bg-theme-dim/40" /><div className="h-1 w-3/5 rounded-full bg-theme-dim/30" /></div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-theme-border">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-theme-dim hover:bg-theme-hover hover:text-theme-fg">Cancel</button>
            <button type="button" onClick={() => { onSave(draftStrength, draftDock, draftEnabled); onClose() }} className="rounded-lg bg-theme-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-theme-accent/90">Save Settings</button>
          </div>
        </div>
      </div>
    </div>
  )
}
