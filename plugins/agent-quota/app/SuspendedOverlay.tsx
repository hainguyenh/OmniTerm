import { useEffect, useState } from 'react'
import { Clock, ShieldAlert, Snowflake, X } from 'lucide-react'

import { AGENT_LABELS, effectiveConfig, WINDOW_LABELS } from './quotaConfig'
import { formatCountdown } from './quotaPolicy'
import { useQuota } from './quotaStore'
import { FROZEN_OVERLAY_EVENT } from './frozenOverlayEvents'

/** Covers a terminal whose agent the guard froze, while allowing the user to inspect the frozen output. */
export function SuspendedOverlay({ sessionId }: { sessionId: string }) {
  const terminal = useQuota((state) => state.terminals[sessionId])
  const guard = useQuota((state) => (terminal ? state.guards[terminal.instanceKey] : undefined))
  const global = useQuota((state) => (terminal ? state.config.agents[terminal.agent] : undefined))
  const override = useQuota((state) => (terminal ? state.overrides[terminal.instanceKey] : undefined))
  const profile = useQuota((state) => (terminal ? state.profiles[terminal.profileKey] : undefined))
  const now = useQuota((state) => state.now)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    setHidden(false)
  }, [sessionId, guard?.phase, guard?.resetsAt])

  useEffect(() => {
    const onShow = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as { sessionId?: unknown } | undefined
      if (detail?.sessionId === sessionId) setHidden(false)
    }
    window.addEventListener(FROZEN_OVERLAY_EVENT, onShow)
    return () => window.removeEventListener(FROZEN_OVERLAY_EVENT, onShow)
  }, [sessionId])

  if (!terminal || !guard || !global || guard.phase === 'active' || hidden) return null

  const quotaWindow = guard.window
  const limit = quotaWindow ? effectiveConfig(global, override).limits[quotaWindow] : undefined
  const windowReset = quotaWindow ? profile?.lastGood?.windows.find((w) => w.kind === quotaWindow)?.resetsAt : undefined
  const countdownTarget = guard.phase === 'guarding'
    ? guard.guardUntil ?? guard.resetsAt ?? windowReset
    : guard.resetsAt ?? windowReset
  const countdown = formatCountdown(countdownTarget, now)
  const stopped = guard.phase === 'stopped'

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 backdrop-blur-[2px]" data-testid="aq-suspended">
      <div role="alert" aria-live="polite" className="relative max-w-sm mx-4 p-4 rounded-2xl border border-theme-warning bg-theme-popup shadow-2xl text-xs text-theme-fg flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-theme-dim hover:bg-theme-bg hover:text-theme-fg"
          aria-label="Hide freeze overlay"
          title="Hide overlay without resuming the process"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="flex items-center gap-2 pr-6 text-sm font-semibold text-theme-warning">
          {stopped ? <ShieldAlert className="w-4 h-4" /> : <Snowflake className="w-4 h-4" />}
          {stopped ? 'Process stopped' : 'Process frozen'}
        </div>
        <div>
          {AGENT_LABELS[terminal.agent]} ({terminal.profileName})
          {quotaWindow && limit !== undefined && ` reached ${Math.round(guard.frozenPct ?? 0)}% of its ${WINDOW_LABELS[quotaWindow].long.toLowerCase()} quota (limit ${limit}%).`}
        </div>
        {!stopped && (
          <div className="flex flex-col gap-1.5 p-2 rounded-xl bg-theme-bg/60 border border-theme-border/60">
            <div className="text-theme-dim text-[11px]">
              {guard.phase === 'guarding'
                ? 'Checking that usage has stopped rising and freezing any new sub-agent.'
                : 'Waiting for the quota to reset.'}
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-theme-fg" data-testid="aq-suspended-timer">
              <Clock className="w-3.5 h-3.5 text-theme-warning" />
              <span>
                Live countdown: {guard.phase === 'guarding' ? 'guard completes' : 'resumes'} in{' '}
                <span className="font-mono text-theme-warning font-bold">
                  {countdown || (countdownTarget && countdownTarget > now ? formatCountdown(countdownTarget, now) : 'pending reset')}.
                </span>
              </span>
            </div>
          </div>
        )}
        <div className="text-[10px] text-theme-dim">
          To resume this process, navigate to Settings → Agent Quota. Hiding this overlay only reveals the frozen terminal; it does not resume the process.
        </div>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="self-start flex items-center gap-1 px-2.5 py-1 rounded-lg border border-theme-border hover:border-theme-accent"
        >
          <X className="w-3 h-3" /> Hide overlay
        </button>
      </div>
    </div>
  )
}
