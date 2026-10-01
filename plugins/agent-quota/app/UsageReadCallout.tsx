import { ScanText, X } from 'lucide-react'

import type { AgentKind } from '../src/types'

import { quotaCommands } from './quotaStore'
import { AGENT_PROBES } from './usageProbeCore'

/**
 * Shown under the strip while its read button waits for a usage panel. Non-modal and never takes
 * focus: the user types the command straight into the pane, and the callout closes itself once the
 * panel has been read.
 */
export function UsageReadCallout({ sessionId, agent }: { sessionId: string; agent: AgentKind }) {
  const command = AGENT_PROBES[agent].command
  return (
    <div className="aq-usage-callout" role="status" aria-live="polite" data-testid="aq-usage-callout">
      <ScanText className="aq-usage-callout-icon" aria-hidden="true" />
      <span className="aq-usage-callout-text">
        No usage panel on screen. Type <code>{command}</code> in this agent — OmniTerm reads it as soon as the panel appears.
      </span>
      <button
        type="button"
        className="aq-icon-button"
        aria-label="Stop waiting for the usage panel"
        title="Stop waiting for the usage panel"
        onClick={() => quotaCommands().cancelUsageRead(sessionId)}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}
