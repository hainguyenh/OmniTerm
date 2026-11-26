import { useEffect, useRef, useState } from 'react'

import type { AgentKind } from './usage/types'
import type { AgentConfig, DisplayConfig, QuotaConfig } from './quotaConfig'

import './agentQuota.css'
import { isSafePrompt } from './usage/prompt'
import { AgentSettingsCard } from './AgentSettingsCard'
import { ClaudeBridgeSettings } from './ClaudeBridgeSettings'
import { LoadingArtSettings } from './LoadingArtSettings'
import { QuotaLinesSettings } from './QuotaLinesSettings'
import { AGENT_KINDS } from './quotaConfig'
import { clearAllManualPauses, clearOverrides, quotaCommands, useCoarseNow, useQuota } from './quotaStore'
import { QuotaSummaryForm } from './QuotaSummaryForm'

type SettingsGroup = 'agents' | 'lines' | 'artwork'

const GROUPS: ReadonlyArray<{ id: SettingsGroup; label: string }> = [
  { id: 'agents', label: 'Agents' },
  { id: 'lines', label: 'Quota lines' },
  { id: 'artwork', label: 'Loading artwork' },
]

/** What a page shows: everything, only what the agents share, or one agent's own settings. */
export type QuotaSettingsScope = 'all' | 'shared' | AgentKind

interface AgentQuotaSettingsProps {
  refreshCustomArt?: () => void
  scope?: QuotaSettingsScope
}

function promptsValid(config: QuotaConfig): boolean {
  return AGENT_KINDS.every((agent) => {
    const wake = config.agents[agent].wake
    return wake.mode === 'off' || isSafePrompt(wake.prompt)
  })
}

/**
 * The Settings → Agents quota pages. With `scope` "shared" it leaves out the per-agent cards (each
 * agent has its own page, `scope` being that agent, which shows only its card). In full: a summary form (master switch, placement, animations, providers,
 * at-limit guard), then three groups — Agents (limits,
 * protection and wake-up per agent), Quota lines (how the pane strips look) and Loading artwork (the
 * busy-header art) — one at a time, each with a live preview of what it controls.
 *
 * Every field edits a local draft. Nothing reaches the engine, the pane bars, or disk until Apply —
 * so switching agents on/off, dragging a limit slider, or typing a wake prompt can't fire a save on
 * every keystroke, and a half-typed prompt can never be persisted.
 */
export default function AgentQuotaSettings({ refreshCustomArt = () => {}, scope = 'all' }: AgentQuotaSettingsProps) {
  const committed = useQuota((state) => state.config)
  const overrideCount = useQuota((state) => Object.keys(state.overrides).length)
  const now = useCoarseNow()
  const [draft, setDraft] = useState<QuotaConfig>(committed)
  const groups = scope === 'shared' ? GROUPS.filter(({ id }) => id !== 'agents') : GROUPS
  const [group, setGroup] = useState<SettingsGroup>(scope === 'shared' ? 'lines' : 'agents')
  const oneAgent = scope === 'all' || scope === 'shared' ? null : scope
  const [resetOverridesToo, setResetOverridesToo] = useState(false)
  const [applied, setApplied] = useState(false)
  const appliedTimerRef = useRef<number | null>(null)
  useEffect(() => () => { if (appliedTimerRef.current !== null) window.clearTimeout(appliedTimerRef.current) }, [])

  const dirty = JSON.stringify(draft) !== JSON.stringify(committed)
  const canApply = dirty && promptsValid(draft)
  const saveAgent = (agent: AgentKind, next: AgentConfig) =>
    setDraft((prev) => ({ ...prev, agents: { ...prev.agents, [agent]: next } }))
  const saveDisplay = (display: DisplayConfig) => setDraft((prev) => ({ ...prev, display }))

  const handleApply = () => {
    if (!canApply) return
    if (draft.enabled && !committed.enabled) clearAllManualPauses()
    for (const agent of AGENT_KINDS) {
      if (draft.agents[agent].enabled && !committed.agents[agent].enabled) clearAllManualPauses(agent)
      if (draft.agents[agent].suspendAtLimit && !committed.agents[agent].suspendAtLimit) clearAllManualPauses(agent)
    }
    quotaCommands().saveConfig(draft)
    if (resetOverridesToo) clearOverrides()
    setResetOverridesToo(false)
    setApplied(true)
    appliedTimerRef.current = window.setTimeout(() => setApplied(false), 2000)
    quotaCommands().refresh()
  }
  const handleReset = () => { setDraft(committed); setResetOverridesToo(false) }

  return (
    <div className="p-5 flex flex-col gap-3 text-theme-fg">
      {!oneAgent && <QuotaSummaryForm draft={draft} onChange={setDraft} />}

      <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl border border-theme-border text-xs sticky top-0 bg-theme-bg z-10">
        {applied
          ? <span role="status" className="flex-1 text-theme-accent font-medium">Applied</span>
          : <span className="flex-1 text-theme-dim">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span>}
        {overrideCount > 0 && (
          <label className="flex items-center gap-1.5 text-theme-dim">
            <input type="checkbox" checked={resetOverridesToo} onChange={() => setResetOverridesToo((v) => !v)} />
            Also reset {overrideCount} terminal{overrideCount === 1 ? '' : 's'} with custom settings
          </label>
        )}
        <button type="button" disabled={!dirty} onClick={handleReset}
          className="px-2.5 py-1 rounded-lg border border-theme-border hover:border-theme-accent disabled:opacity-40"
        >
          Reset
        </button>
        <button type="button" disabled={!canApply} onClick={handleApply}
          title={dirty && !promptsValid(draft) ? 'Fix a wake prompt before applying' : undefined}
          className="px-2.5 py-1 rounded-lg bg-theme-accent text-theme-accent-fg font-semibold disabled:opacity-40"
        >
          Apply
        </button>
      </div>

      {oneAgent && (draft.enabled
        ? (
          <>
            <AgentSettingsCard agent={oneAgent} config={draft.agents[oneAgent]} defaultExpanded onChange={(next) => saveAgent(oneAgent, next)} />
            {oneAgent === 'claude' && <ClaudeBridgeSettings />}
          </>
        )
        : <p className="px-1 text-xs text-theme-dim">Agent quota is off. Turn it on under Agents › Quota to monitor this agent.</p>)}

      {!oneAgent && draft.enabled && (
        <>
          <div role="tablist" aria-label="Agent Quota settings groups" className="flex gap-1 p-0.5 rounded-xl border border-theme-border text-xs">
            {groups.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`aq-settings-tab-${id}`}
                aria-selected={group === id}
                aria-controls="aq-settings-panel"
                onClick={() => setGroup(id)}
                className={`flex-1 px-2 py-1 rounded-lg transition-colors ${
                  group === id ? 'bg-theme-accent text-theme-accent-fg font-semibold' : 'text-theme-dim hover:text-theme-fg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="aq-settings-panel" aria-labelledby={`aq-settings-tab-${group}`} className="flex flex-col gap-2">
            {group === 'agents' && AGENT_KINDS.map((agent) => (
              <AgentSettingsCard
                key={agent}
                agent={agent}
                config={draft.agents[agent]}
                defaultExpanded={agent === 'claude'}
                onChange={(next) => saveAgent(agent, next)}
              />
            ))}
            {group === 'agents' && <ClaudeBridgeSettings />}
            {group === 'lines' && <QuotaLinesSettings display={draft.display} onChange={saveDisplay} now={now} />}
            {group === 'artwork' && <LoadingArtSettings display={draft.display} onChange={saveDisplay} refreshCustomArt={refreshCustomArt} />}
          </div>
        </>
      )}
    </div>
  )
}
