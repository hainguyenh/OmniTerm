import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import type { AgentKind, QuotaWindow, WindowKind } from '../src/types'
import type { AgentConfig, WakeMode } from './quotaConfig'

import { isSafePrompt } from '../src/prompt'
import { confirmDisableSuspend } from './dangerConfirm'
import { AgentIcon, QuotaLine } from './QuotaLine'
import { AGENT_LABELS, clampLimit, WINDOW_KINDS, WINDOW_LABELS } from './quotaConfig'
import { useQuota } from './quotaStore'
import { CompactSwitch, FIELD, SubHeading, Switch } from './settingsControls'

const WAKE_MODES: Array<{ id: WakeMode; label: string }> = [
  { id: 'off', label: 'Off' },
  { id: 'afterReset', label: 'After each session reset' },
  { id: 'timeOfDay', label: 'Every day at a time' },
]

/** Sample usage for the limits preview, so each line shows how its limit colours a typical reading. */
const PREVIEW_USED: Record<WindowKind, number> = { session: 62, weekly: 48, monthly: 30 }

interface AgentSettingsCardProps {
  agent: AgentKind
  config: AgentConfig
  onChange: (next: AgentConfig) => void
  defaultExpanded?: boolean
}

const minutes = (value: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)))

/** `5h 90% · Weekly 95% · Monthly 95% · Suspend on · Wake off` — the collapsed card's one line. */
function agentSummary(config: AgentConfig): string {
  if (!config.enabled) return 'Not monitored'
  const limits = WINDOW_KINDS.map((kind) => `${kind === 'session' ? '5h' : WINDOW_LABELS[kind].long} ${config.limits[kind]}%`)
  const wake = config.wake.mode === 'off' ? 'Wake off' : config.wake.mode === 'timeOfDay' ? `Wake ${config.wake.time}` : 'Wake after reset'
  return [...limits, `Suspend ${config.suspendAtLimit ? 'on' : 'off'}`, wake].join(' · ')
}

/**
 * One agent's global quota settings: a one-line summary row with the monitor switch, expanding to
 * Limits (with a live preview), Protection, Wake-up and Header icon. Edits go to the parent's draft.
 */
export function AgentSettingsCard({ agent, config, onChange, defaultExpanded = false }: AgentSettingsCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const now = useQuota((state) => state.now)
  const patch = (fields: Partial<AgentConfig>) => onChange({ ...config, ...fields })
  const toggleSuspend = () => {
    if (config.suspendAtLimit) confirmDisableSuspend(AGENT_LABELS[agent], () => patch({ suspendAtLimit: false }))
    else patch({ suspendAtLimit: true })
  }
  const name = AGENT_LABELS[agent]
  const promptValid = isSafePrompt(config.wake.prompt)
  const open = expanded && config.enabled
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <section className="rounded-xl border border-theme-border text-xs" aria-label={`${name} quota settings`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} ${name} settings`}
          disabled={!config.enabled}
          onClick={() => setExpanded((value) => !value)}
          className="flex flex-1 min-w-0 items-center gap-2 text-left disabled:cursor-default"
        >
          <Chevron className={`w-3.5 h-3.5 shrink-0 text-theme-dim ${config.enabled ? '' : 'opacity-0'}`} />
          <AgentIcon agent={agent} icon={config.icon} className="w-4 h-4 shrink-0" />
          <span className="font-semibold text-theme-fg text-sm shrink-0">{name}</span>
          <span className="truncate text-[11px] text-theme-dim" data-testid={`${agent}-summary`}>{agentSummary(config)}</span>
        </button>
        <Switch checked={config.enabled} onChange={() => patch({ enabled: !config.enabled })} ariaLabel={`Monitor ${name}`} />
      </div>

      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3 pt-1 border-t border-theme-border">
          <div className="flex flex-col gap-1.5 pt-2">
            <SubHeading hint="The used % at which a window counts as exhausted: past it the line turns red and the agent can be suspended.">Limits</SubHeading>
            {WINDOW_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-theme-fg">
                <span className="w-20 text-theme-dim">{WINDOW_LABELS[kind].long}</span>
                <input
                  type="range" min={5} max={100} value={config.limits[kind]}
                  aria-label={`${name} ${WINDOW_LABELS[kind].long} limit`}
                  onChange={(event) => patch({ limits: { ...config.limits, [kind]: clampLimit(Number(event.target.value)) } })}
                  className="flex-1 accent-[var(--theme-accent)]"
                />
                <span className="w-10 text-right tabular-nums">{config.limits[kind]}%</span>
              </label>
            ))}
            <div className="aq-strip aq-size-normal rounded-lg border border-theme-border" aria-label={`${name} limits preview`}>
              <div className="aq-lines">
                {WINDOW_KINDS.map((kind) => {
                  const window: QuotaWindow = { kind, label: 'Preview', usedPct: PREVIEW_USED[kind] }
                  return <QuotaLine key={kind} window={window} limit={config.limits[kind]} animations={false} showReset={false} now={now} />
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <SubHeading>Protection</SubHeading>
            <CompactSwitch
              label="Suspend at limit"
              note="freeze the agent and its sub-agents"
              hint="Freeze the agent and its AI sub-agents when a limit is reached. Scripts keep running."
              checked={config.suspendAtLimit}
              onChange={toggleSuspend}
              ariaLabel={`Suspend ${name} at its limit`}
            />
            <CompactSwitch
              label="Resume after reset"
              note="thaw once usage is under every limit"
              checked={config.autoResume}
              onChange={() => patch({ autoResume: !config.autoResume })}
              ariaLabel={`Resume ${name} after the reset`}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-theme-dim">
              <label className="flex items-center gap-1.5" title="Minutes after a reset before resuming, so the provider has really rolled over.">
                Resume delay (min)
                <input type="number" min={0} max={120} value={config.resumeDelayMinutes} className={`${FIELD} w-14`}
                  onChange={(event) => patch({ resumeDelayMinutes: minutes(event.target.value, 0, 120) })} />
              </label>
              <label className="flex items-center gap-1.5" title="How long usage keeps being checked often after a suspend.">
                Watch after suspend (min)
                <input type="number" min={1} max={60} value={config.guardMinutes} className={`${FIELD} w-14`}
                  onChange={(event) => patch({ guardMinutes: minutes(event.target.value, 1, 60) })} />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={config.hardStopAtPct !== null}
                  onChange={() => patch({ hardStopAtPct: config.hardStopAtPct === null ? 99 : null })} />
                Stop if usage still rises past
                <input type="number" min={5} max={100} disabled={config.hardStopAtPct === null} value={config.hardStopAtPct ?? 99}
                  aria-label="Hard stop percentage" className={`${FIELD} w-14`}
                  onChange={(event) => patch({ hardStopAtPct: clampLimit(Number(event.target.value)) })} />%
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 text-theme-dim">
            <SubHeading hint="Sends one tiny prompt so a new session window starts on time. Only profiles open in a terminal are woken.">Wake-up</SubHeading>
            <div className="flex flex-wrap items-center gap-2">
              <select value={config.wake.mode} aria-label={`${name} wake-up schedule`} className={FIELD}
                onChange={(event) => patch({ wake: { ...config.wake, mode: event.target.value as WakeMode } })}
              >
                {WAKE_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
              </select>
              {config.wake.mode === 'timeOfDay' && (
                <input type="time" value={config.wake.time} aria-label="Wake time" className={FIELD}
                  onChange={(event) => event.target.value && patch({ wake: { ...config.wake, time: event.target.value } })} />
              )}
              {config.wake.mode === 'afterReset' && (
                <label className="flex items-center gap-1">
                  +
                  <input type="number" min={0} max={120} value={config.wake.delayMinutes} aria-label="Minutes after the reset" className={`${FIELD} w-14`}
                    onChange={(event) => patch({ wake: { ...config.wake, delayMinutes: minutes(event.target.value, 0, 120) } })} />
                  min
                </label>
              )}
              {config.wake.mode !== 'off' && (
                <label className="flex flex-1 min-w-[10rem] items-center gap-1.5">
                  Prompt
                  <input type="text" maxLength={120} value={config.wake.prompt} className={`${FIELD} flex-1 ${promptValid ? '' : 'border-theme-error'}`}
                    onChange={(event) => patch({ wake: { ...config.wake, prompt: event.target.value } })} />
                </label>
              )}
            </div>
            {config.wake.mode !== 'off' && !promptValid && <span className="text-theme-error">Use letters, digits and simple punctuation only.</span>}
          </div>

          <div className="flex items-center gap-2 text-theme-dim">
            <label htmlFor={`${agent}-header-icon`} className="w-20">Header icon</label>
            <select
              id={`${agent}-header-icon`}
              aria-label={`${name} header icon mode`}
              className={FIELD}
              value={config.icon.mode}
              onChange={(event) => patch({ icon: { ...config.icon, mode: event.target.value as AgentConfig['icon']['mode'] } })}
            >
              <option value="default">Default</option>
              <option value="emoji">Custom emoji</option>
            </select>
            {config.icon.mode === 'emoji' && (
              <input
                aria-label={`${name} custom header icon`}
                className={`${FIELD} w-14 text-center`}
                maxLength={8}
                value={config.icon.value}
                placeholder="🐙"
                onChange={(event) => patch({ icon: { ...config.icon, value: event.target.value } })}
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
