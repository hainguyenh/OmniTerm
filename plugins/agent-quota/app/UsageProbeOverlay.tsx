import { Gauge } from 'lucide-react'

import './agentQuota.css'
import { useUsageProbe } from './inlineUsageProbe'

/**
 * Freezes a pane while the inline quota probe types `/usage` (or `/status`) into its agent: the
 * pane is veiled, so the panel it opens and closes does not flash by, and clicks cannot reach the
 * terminal. Keystrokes are held, not lost, and reach the agent right after. Focus is left alone.
 */
export function UsageProbeOverlay({ sessionId }: { sessionId: string }) {
  const command = useUsageProbe(sessionId)
  if (!command) return null
  return (
    <div
      className="aq-probe-veil absolute inset-0 z-20 flex items-center justify-center"
      role="status"
      aria-live="polite"
      data-testid="usage-probe-overlay"
    >
      <div className="aq-probe-badge flex items-center gap-2 rounded-full border border-theme-border px-3 py-1.5 text-[11px] text-theme-fg shadow-lg">
        <Gauge className="h-3.5 w-3.5 animate-pulse text-theme-accent" />
        <span>
          Reading quota with <code className="font-mono">{command}</code>… your keystrokes are kept and sent right after.
        </span>
      </div>
    </div>
  )
}
