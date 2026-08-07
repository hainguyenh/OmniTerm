import { useState } from 'react'
import { MoonStar, X } from 'lucide-react'
import { useEscToClose } from '../../../ui/hooks/useEscToClose'

type Duration = 'today' | '24h' | 'nextMonday'

function expiryFor(duration: Duration): number {
  const now = new Date()
  if (duration === '24h') return now.getTime() + 24 * 60 * 60 * 1000
  if (duration === 'today') {
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return end.getTime()
  }
  const next = new Date(now)
  const days = ((1 - next.getDay() + 7) % 7) || 7
  next.setDate(next.getDate() + days)
  next.setHours(8, 0, 0, 0)
  return next.getTime()
}

export default function AlwaysAwakeModal({
  status,
  onClose,
  onSaved,
}: {
  status: AlwaysAwakeStatus
  onClose: () => void
  onSaved: (next: AlwaysAwakeStatus) => void
}) {
  const [mode, setMode] = useState<AlwaysAwakeMode>(status.mode)
  const [duration, setDuration] = useState<Duration>('24h')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEscToClose(false, onClose, onClose)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await window.omnitermAPI.alwaysAwake.setState({
        enabled: true,
        mode,
        expiresAtMs: expiryFor(duration),
      })
      onSaved(next)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    setError(null)
    try {
      onSaved(await window.omnitermAPI.alwaysAwake.disable())
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm p-4"
      style={{ backgroundColor: 'var(--theme-overlay)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[26rem] max-w-full bg-theme-popup rounded-2xl border border-theme-border shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-theme-border">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: 'var(--theme-hover-bg)', color: 'var(--theme-accent)' }}
            >
              <MoonStar className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-theme-fg">Always Awake</h2>
              <p className="text-[11px] leading-snug text-theme-dim">Prevent Windows sleep while OmniTerm is working.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} title="Close" className="shrink-0 rounded-lg p-1 text-theme-dim hover:bg-theme-hover hover:text-theme-fg">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {!status.supported && <p className="text-xs text-theme-error">Always Awake is currently supported on Windows only.</p>}
          {status.error && <p className="text-xs text-theme-error">{status.error}</p>}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-theme-fg">Mode</legend>
            <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${mode === 'activeOnly' ? 'border-theme-accent bg-theme-hover' : 'border-theme-border'}`}>
              <input
                type="radio"
                name="always-awake-mode"
                value="activeOnly"
                checked={mode === 'activeOnly'}
                onChange={() => setMode('activeOnly')}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                style={{ accentColor: 'var(--theme-accent)' }}
              />
              <span>
                <span className="block text-xs font-medium text-theme-fg">While terminal work is active</span>
                <span className="block text-[10px] text-theme-dim">Prevent sleep only while a terminal has active work.</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${mode === 'always' ? 'border-theme-accent bg-theme-hover' : 'border-theme-border'}`}>
              <input
                type="radio"
                name="always-awake-mode"
                value="always"
                checked={mode === 'always'}
                onChange={() => setMode('always')}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                style={{ accentColor: 'var(--theme-accent)' }}
              />
              <span>
                <span className="block text-xs font-medium text-theme-fg">Always during schedule</span>
                <span className="block text-[10px] text-theme-dim">Prevent sleep for the entire selected schedule.</span>
              </span>
            </label>
          </fieldset>
          <div>
            <p className="text-xs font-semibold text-theme-fg mb-2">Keep awake for</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['today', 'Today'],
                ['24h', '24 hours'],
                ['nextMonday', 'Mon 08:00'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setDuration(value)} className={`rounded-lg border px-2 py-2 text-[11px] ${duration === value ? 'border-[var(--theme-accent)] text-[var(--theme-accent)]' : 'border-theme-border text-theme-dim'}`}>{label}</button>
              ))}
            </div>
          </div>
          <div
            className="flex items-center justify-between rounded-lg border border-theme-border px-3 py-2 text-[11px]"
            style={{ backgroundColor: 'var(--theme-hover-bg)' }}
          >
            <span className="text-theme-dim">
              Status
              {status.enabled && status.activeSessionCount > 0 && (
                <span className="ml-1">· {status.activeSessionCount} active session{status.activeSessionCount === 1 ? '' : 's'}</span>
              )}
            </span>
            <span className={status.enabled ? 'text-theme-accent font-semibold' : 'text-theme-dim'}>{status.enabled ? (status.keepingAwake ? 'Active' : 'Enabled, waiting') : 'Off'}</span>
          </div>
          {error && <p className="text-xs text-theme-error">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-theme-border px-5 py-3">
          <button type="button" disabled={busy} onClick={() => void disable()} className="px-3 py-1.5 rounded-lg border border-theme-border text-xs text-theme-error hover:bg-theme-hover disabled:opacity-50">Off</button>
          <button type="button" disabled={busy || !status.supported} onClick={() => void save()} className="px-4 py-1.5 rounded-lg bg-[var(--theme-accent)] text-theme-accent-fg text-xs font-semibold disabled:opacity-50">Save</button>
        </div>
      </div>
    </div>
  )
}
