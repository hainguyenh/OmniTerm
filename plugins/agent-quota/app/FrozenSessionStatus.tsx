import { ShieldAlert, Snowflake } from 'lucide-react'

import { formatCountdown } from './quotaPolicy'
import { showSuspendedOverlay } from './frozenOverlayEvents'
import { setReviewSession, useQuota } from './quotaStore'

/** Compact footer status for a session held by the quota guard. */
export function FrozenSessionStatus({ sessionId }: { sessionId: string }) {
  const terminal = useQuota((state) => state.terminals[sessionId])
  const guard = useQuota((state) => (terminal ? state.guards[terminal.instanceKey] : undefined))
  const now = useQuota((state) => state.now)
  if (!guard || guard.phase === 'active') return null

  const stopped = guard.phase === 'stopped'
  const countdown = stopped || guard.phase === 'guarding' ? null : formatCountdown(guard.resetsAt, now)
  const handleClick = () => {
    showSuspendedOverlay(sessionId)
    setReviewSession(sessionId)
  }
  return (
    <button
      type="button"
      data-testid="aq-frozen-status"
      onClick={handleClick}
      className={`inline-flex min-w-0 items-center gap-1 rounded-full bg-theme-bg px-1.5 py-0.5 text-[10px] font-semibold transition-colors hover:text-theme-accent ${stopped ? 'text-theme-error' : 'text-theme-warning'}`}
      aria-label={stopped ? 'Process stopped by quota guard' : 'Process frozen'}
      title="Review suspended processes & threads"
    >
      {stopped ? <ShieldAlert className="h-3 w-3" /> : <Snowflake className="h-3 w-3" />}
      {stopped ? 'Stopped' : 'Frozen'}
      {countdown && (
        <span className="font-normal text-theme-dim">
          · resumes in {countdown}
        </span>
      )}
    </button>
  )
}
