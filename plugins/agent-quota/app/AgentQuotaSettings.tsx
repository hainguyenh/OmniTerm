import { useEffect, useRef, useState } from 'react'

import type { AgentKind } from '../src/types'
import type { AgentConfig, DisplayConfig, QuotaConfig } from './quotaConfig'

import './agentQuota.css'
import { isSafePrompt } from '../src/prompt'
import { AgentSettingsCard } from './AgentSettingsCard'
import { LoadingArtSettings } from './LoadingArtSettings'
import { QuotaLinesSettings } from './QuotaLinesSettings'
import { AGENT_KINDS } from './quotaConfig'
import { clearOverrides, quotaCommands, useQuota } from './quotaStore'
import { CompactSwitch } from './settingsControls'

type SettingsGroup = 'agents' | 'lines' | 'artwork'

const GROUPS: ReadonlyArray<{ id: SettingsGroup; label: string }> = [
  { id: 'agents', label: 'Agents' },
  { id: 'lines', label: 'Quota lines' },
  { id: 'artwork', label: 'Loading artwork' },
]

interface AgentQuotaSettingsProps {
  refreshCustomArt?: () => void
}

function promptsValid(config: QuotaConfig): boolean {
  return AGENT_KINDS.every((agent) => {
    const wake = config.agents[agent].wake
    return wake.mode === 'off' || isSafePrompt(wake.prompt)
  })
}

/**
 * The Settings → Agent Quota tab: the master switch and the pin, then three groups — Agents (limits,
 * protection and wake-up per agent), Quota lines (how the pane strips look) and Loading artwork (the
 * busy-header art) — one at a time, each with a live preview of what it controls.
 *
 * Every field edits a local draft. Nothing reaches the engine, the pane bars, or disk until Apply —
 * so switching agents on/off, dragging a limit slider, or typing a wake prompt can't fire a save on
 * every keystroke, and a half-typed prompt can never be persisted.
 */
export default function AgentQuotaSettings({ refreshCustomArt = () => {} }: AgentQuotaSettingsProps) {
  const committed = useQuota((state) => state.config)
  const overrideCount = useQuota((state) => Object.keys(state.overrides).length)
  const now = useQuota((state) => state.now)
  const [draft, setDraft] = useState<QuotaConfig>(committed)
  const [group, setGroup] = useState<SettingsGroup>('agents')
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
    quotaCommands().saveConfig(draft)
    if (resetOverridesToo) clearOverrides()
    setResetOverridesToo(false)
    setApplied(true)
    appliedTimerRef.current = window.setTimeout(() => setApplied(false), 2000)
  }
  const handleReset = () => { setDraft(committed); setResetOverridesToo(false) }

  return (
    <div className="p-5 flex flex-col gap-3 text-theme-fg">
      <div className="flex flex-col gap-0.5 px-1">
        <CompactSwitch
          label="Agent Quota"
          note="quota lines for AI agents in each terminal, and limit guards"
          checked={draft.enabled}
          onChange={() => setDraft({ ...draft, enabled: !draft.enabled })}
          ariaLabel="Enable Agent Quota"
        />
        <CompactSwitch
          label="Pin to activity bar"
          note="quick-settings icon"
          hint="Keep the quick-settings icon in the activity bar (shortcut: Agent Quota in Shortcuts)."
          checked={draft.pinned}
          onChange={() => setDraft({ ...draft, pinned: !draft.pinned })}
          ariaLabel="Pin Agent Quota to the activity bar"
        />
      </div>

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

      {draft.enabled && (
        <>
          <div role="tablist" aria-label="Agent Quota settings groups" className="flex gap-1 p-0.5 rounded-xl border border-theme-border text-xs">
            {GROUPS.map(({ id, label }) => (
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
            {group === 'lines' && <QuotaLinesSettings display={draft.display} onChange={saveDisplay} now={now} />}
            {group === 'artwork' && <LoadingArtSettings display={draft.display} onChange={saveDisplay} refreshCustomArt={refreshCustomArt} />}
          </div>
        </>
      )}
    </div>
  )
}
