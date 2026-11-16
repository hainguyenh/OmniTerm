import type { AgentKind } from './usage/types'
import type { QuotaConfig } from './quotaConfig'

import { confirmDisableSuspend } from './dangerConfirm'
import { AGENT_KINDS, AGENT_LABELS } from './quotaConfig'
import { placementOf, withPlacement, type QuotaPlacement } from './quotaPlacement'

const PLACEMENTS: ReadonlyArray<{ id: QuotaPlacement; label: string }> = [
  { id: 'activity', label: 'Activity bar icon (quick settings)' },
  { id: 'footer', label: 'Footer status line (one chip per agent profile)' },
  { id: 'both', label: 'Activity bar icon + footer' },
  { id: 'hidden', label: 'Hidden' },
]

const SELECT = 'w-full rounded-md border border-theme-border bg-theme-bg px-2 py-1 text-xs text-theme-fg'
const CHECK = 'flex items-center gap-1.5 text-xs text-theme-fg'

interface QuotaSummaryFormProps {
  draft: QuotaConfig
  onChange: (next: QuotaConfig) => void
}

/**
 * The top of the Agent quota page (UI prototype, Settings › Plugins › Agent quota):
 * the master switch, placement, animations, monitored providers and the at-limit guard, as one form.
 * The per-agent cards below still edit each agent's limits and wake-up in detail.
 */
export function QuotaSummaryForm({ draft, onChange }: QuotaSummaryFormProps) {
  const monitored = AGENT_KINDS.filter((agent) => draft.agents[agent].enabled)
  const guarded = monitored.filter((agent) => draft.agents[agent].suspendAtLimit)
  const allGuarded = monitored.length > 0 && guarded.length === monitored.length
  const setAgent = (agent: AgentKind, fields: Partial<QuotaConfig['agents'][AgentKind]>, base = draft) =>
    ({ ...base, agents: { ...base.agents, [agent]: { ...base.agents[agent], ...fields } } })
  const setSuspend = (on: boolean) => {
    const next = monitored.reduce((config, agent) => setAgent(agent, { suspendAtLimit: on }, config), draft)
    if (on) onChange(next)
    else confirmDisableSuspend('Every monitored agent', () => onChange(next))
  }

  return (
    <div className="grid grid-cols-[150px_1fr] items-center gap-x-3 gap-y-2 px-1 text-xs text-theme-fg">
      <span>Agent quota</span>
      <label className={CHECK}>
        <input
          type="checkbox"
          aria-label="Enable Agent Quota"
          checked={draft.enabled}
          onChange={() => onChange({ ...draft, enabled: !draft.enabled })}
        />
        Quota lines for AI agents in each terminal, and limit guards
      </label>
      <span>Display</span>
      <select
        aria-label="Agent quota display"
        className={SELECT}
        value={placementOf(draft)}
        onChange={(e) => onChange(withPlacement(draft, e.target.value as QuotaPlacement))}
      >
        {PLACEMENTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <span>Animations</span>
      <label className={CHECK}>
        <input
          type="checkbox"
          checked={draft.display.animations}
          onChange={() => onChange({ ...draft, display: { ...draft.display, animations: !draft.display.animations } })}
        />
        Show animations (bar shimmer, pulse near the limit)
      </label>
      <span>Providers</span>
      <div className="flex flex-wrap gap-3">
        {AGENT_KINDS.map((agent) => (
          <label key={agent} className={CHECK}>
            <input
              type="checkbox"
              checked={draft.agents[agent].enabled}
              onChange={() => onChange(setAgent(agent, { enabled: !draft.agents[agent].enabled }))}
            />
            {AGENT_LABELS[agent]}
          </label>
        ))}
      </div>
      <span>At the limit</span>
      <label className={CHECK}>
        <input
          type="checkbox"
          disabled={monitored.length === 0}
          checked={allGuarded}
          ref={(el) => { if (el) el.indeterminate = guarded.length > 0 && !allGuarded }}
          onChange={() => setSuspend(!allGuarded)}
        />
        Suspend the agent at its limit (wake-up per agent below)
      </label>
      <span>Status</span>
      <span>
        {draft.enabled
          ? <span className="rounded-lg bg-theme-success/20 px-1.5 text-[10.5px] text-theme-success">Running</span>
          : <span className="rounded-lg bg-theme-border/40 px-1.5 text-[10.5px] text-theme-dim">Off</span>}
      </span>
    </div>
  )
}
