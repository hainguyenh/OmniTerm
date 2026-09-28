import { AlarmClock, Gauge, Pin, PinOff, Play, RefreshCw, Settings, Snowflake, Users, X } from 'lucide-react'
import { useEffect } from 'react'

import type { AgentKind } from '../src/types'
import type { QuotaConfig } from './quotaConfig'

import { confirmDisableSuspend } from './dangerConfirm'
import { AgentIcon } from './QuotaLine'
import { AGENT_KINDS, AGENT_LABELS } from './quotaConfig'
import { setDashboardOpen } from './profileDashboard'
import { isHeld } from './quotaGuard'
import { quotaCommands, setQuickOpen, useQuota } from './quotaStore'

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange}
      className={`shrink-0 w-8 h-4 rounded-full relative transition-colors ${checked ? 'bg-theme-accent' : 'bg-[#414868]'}`}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

/**
 * Quick settings, opened from the pinned activity-bar icon or the shortcut: the global switch, a
 * switch per agent, plus "wake all" and "resume all".
 */
export function QuotaQuickPopover() {
  const config = useQuota((state) => state.config)
  const terminals = useQuota((state) => state.terminals)
  const guards = useQuota((state) => state.guards)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQuickOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const save = (next: QuotaConfig) => quotaCommands().saveConfig(next)
  const setAgent = (agent: AgentKind, enabled: boolean) =>
    save({ ...config, agents: { ...config.agents, [agent]: { ...config.agents[agent], enabled } } })
  const toggleGlobalSuspend = () => {
    const allOn = AGENT_KINDS.every((agent) => config.agents[agent].suspendAtLimit)
    const next = (value: boolean): QuotaConfig => ({
      ...config,
      agents: Object.fromEntries(AGENT_KINDS.map((agent) => [agent, { ...config.agents[agent], suspendAtLimit: value }])) as QuotaConfig['agents'],
    })
    if (allOn) confirmDisableSuspend('Every agent', () => save(next(false)))
    else save(next(true))
  }
  const rows = Object.values(terminals)
  const anyHeld = rows.some((terminal) => isHeld(guards[terminal.instanceKey]))

  return (
    <div role="dialog" aria-label="Agent Quota quick settings"
      className="fixed left-14 bottom-4 z-50 w-80 max-h-[70vh] overflow-y-auto p-3 rounded-2xl border border-theme-border bg-theme-popup shadow-2xl text-xs text-theme-fg flex flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <Gauge className="w-4 h-4 text-theme-accent" />
        <span className="flex-1 font-bold tracking-wide">Agent Quota</span>
        <Switch checked={config.enabled} label="Agent Quota on" onChange={() => save({ ...config, enabled: !config.enabled })} />
        <button type="button" aria-label={config.pinned ? 'Unpin from activity bar' : 'Pin to activity bar'} title={config.pinned ? 'Unpin from activity bar' : 'Pin to activity bar'}
          className="aq-icon-button" onClick={() => save({ ...config, pinned: !config.pinned })}
        >
          {config.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        </button>
        <button type="button" aria-label="Close" className="aq-icon-button" onClick={() => setQuickOpen(false)}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {AGENT_KINDS.map((agent) => (
          <div key={agent} className="flex items-center gap-2">
            <AgentIcon agent={agent} className="w-3.5 h-3.5" />
            <span className="flex-1">{AGENT_LABELS[agent]}</span>
            <span className="text-theme-dim tabular-nums">{config.agents[agent].limits.session}% · {config.agents[agent].limits.weekly}%</span>
            <Switch checked={config.agents[agent].enabled} label={`Monitor ${AGENT_LABELS[agent]}`} onChange={() => setAgent(agent, !config.agents[agent].enabled)} />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Snowflake className="w-3.5 h-3.5" />
          <span className="flex-1">Suspend at limit (all agents)</span>
          <Switch checked={AGENT_KINDS.every((agent) => config.agents[agent].suspendAtLimit)} label="Suspend every agent at its limit" onChange={toggleGlobalSuspend} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={rows.length === 0} onClick={() => quotaCommands().wake('all')}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-theme-border hover:border-theme-accent disabled:opacity-40"
        >
          <AlarmClock className="w-3 h-3" /> Wake all open profiles
        </button>
        {anyHeld && (
          <button type="button" onClick={() => quotaCommands().resumeAll()} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-theme-warning text-theme-warning">
            <Play className="w-3 h-3" /> Resume all
          </button>
        )}
        <button type="button" onClick={() => quotaCommands().refresh()} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-theme-border hover:border-theme-accent">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
        <button type="button" onClick={() => { setQuickOpen(false); setDashboardOpen(true) }} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-theme-border hover:border-theme-accent">
          <Users className="w-3 h-3" /> Profiles
        </button>
        <button type="button" onClick={() => quotaCommands().openSettings()} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-theme-border hover:border-theme-accent">
          <Settings className="w-3 h-3" /> Settings
        </button>
      </div>
    </div>
  )
}
