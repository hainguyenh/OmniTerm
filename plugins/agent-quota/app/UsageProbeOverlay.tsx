import { Gauge } from 'lucide-react'

import { useUsageProbe } from './inlineUsageProbe'

/**
 * Shown over a pane while the inline `/usage` probe owns it, so the brief pause in typing (input
 * is held, not lost) has an explanation. Non-interactive: it never takes the pointer or focus.
 */
export function UsageProbeOverlay({ sessionId }: { sessionId: string }) {
  const probing = useUsageProbe(sessionId)
  if (!probing) return null
  return (
    <div
      className="pointer-events-none absolute right-3 top-2 z-20 flex items-center gap-1.5 rounded-full border border-theme-border bg-theme-sidebar/90 px-2.5 py-1 text-[11px] text-theme-fg shadow-lg"
      role="status"
      data-testid="usage-probe-overlay"
    >
      <Gauge className="h-3.5 w-3.5 animate-pulse text-theme-accent" />
      Reading quota… your keystrokes are kept and sent right after.
    </div>
  )
}
