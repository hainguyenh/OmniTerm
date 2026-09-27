import type { AgentKind } from '../src/types'
import type { AgentConfig, WakeMode } from './quotaConfig'

import ToggleRow from '../../../ui/components/ToggleRow'
import { isSafePrompt } from '../src/prompt'
import { confirmDisableSuspend } from './dangerConfirm'
import { AgentIcon } from './QuotaLine'
import { AGENT_LABELS, clampLimit, WINDOW_KINDS, WINDOW_LABELS } from './quotaConfig'

const FIELD = 'bg-theme-bg border border-theme-border rounded-lg text-xs text-theme-fg px-2 py-1 focus:outline-none focus:border-theme-accent'
const LABEL = 'text-[10px] text-theme-fg uppercase font-bold tracking-widest'

const WAKE_MODES: Array<{ id: WakeMode; label: string }> = [
  { id: 'off', label: 'Off' },
  { id: 'afterReset', label: 'After each session reset' },
  { id: 'timeOfDay', label: 'Every day at a time' },
]

interface AgentSettingsCardProps {
  agent: AgentKind
  config: AgentConfig
  onChange: (next: AgentConfig) => void
}

const minutes = (value: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)))

/** One agent's global quota settings. Every change is saved immediately by the parent. */
export function AgentSettingsCard({ agent, config, onChange }: AgentSettingsCardProps) {
  const patch = (fields: Partial<AgentConfig>) => onChange({ ...config, ...fields })
  const toggleSuspend = () => {
    if (config.suspendAtLimit) confirmDisableSuspend(AGENT_LABELS[agent], () => patch({ suspendAtLimit: false }))
    else patch({ suspendAtLimit: true })
  }
  const promptValid = isSafePrompt(config.wake.prompt)

  return (
    <section className="rounded-2xl border border-theme-border p-3 flex flex-col gap-3" aria-label={`${AGENT_LABELS[agent]} quota settings`}>
      <ToggleRow
        icon={<AgentIcon agent={agent} className="w-4 h-4" />}
        label={AGENT_LABELS[agent]}
        description={config.enabled ? 'Monitored in every terminal that runs it.' : 'Not monitored.'}
        checked={config.enabled}
        onChange={() => patch({ enabled: !config.enabled })}
        ariaLabel={`Monitor ${AGENT_LABELS[agent]}`}
      />
      {config.enabled && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Limits</span>
            {WINDOW_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-xs text-theme-fg">
                <span className="w-24 text-theme-dim">{WINDOW_LABELS[kind].long}</span>
                <input
                  type="range" min={5} max={100} value={config.limits[kind]}
                  aria-label={`${AGENT_LABELS[agent]} ${WINDOW_LABELS[kind].long} limit`}
                  onChange={(event) => patch({ limits: { ...config.limits, [kind]: clampLimit(Number(event.target.value)) } })}
                  className="flex-1 accent-[var(--theme-accent)]"
                />
                <span className="w-10 text-right tabular-nums">{config.limits[kind]}%</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label htmlFor={`${agent}-header-icon`} className="w-24 text-theme-dim">Header icon</label>
            <select
              id={`${agent}-header-icon`}
              aria-label={`${AGENT_LABELS[agent]} header icon mode`}
              className={FIELD}
              value={config.icon.mode}
              onChange={(event) => onChange({ ...config, icon: { ...config.icon, mode: event.target.value as AgentConfig['icon']['mode'] } })}
            >
              <option value="default">Default</option>
              <option value="emoji">Custom emoji</option>
            </select>
            {config.icon.mode === 'emoji' && (
              <input
                id={`${agent}-header-icon-value`}
                aria-label={`${AGENT_LABELS[agent]} custom header icon`}
                className={`${FIELD} w-14 text-center`}
                maxLength={8}
                value={config.icon.value}
                placeholder="🐙"
                onChange={(event) => patch({ icon: { ...config.icon, value: event.target.value } })}
              />
            )}
          </div>
          <ToggleRow
            label="Suspend at limit"
            description="Freeze the agent and its AI sub-agents when a limit is reached. Scripts keep running."
            checked={config.suspendAtLimit}
            onChange={toggleSuspend}
            ariaLabel={`Suspend ${AGENT_LABELS[agent]} at its limit`}
          />
          <ToggleRow
            label="Resume after reset"
            description="Thaw automatically once the window resets and usage is under every limit."
            checked={config.autoResume}
            onChange={() => patch({ autoResume: !config.autoResume })}
            ariaLabel={`Resume ${AGENT_LABELS[agent]} after the reset`}
          />
          <div className="grid grid-cols-2 gap-2 text-xs text-theme-dim">
            <label className="flex flex-col gap-1">
              Resume delay (min)
              <input type="number" min={0} max={120} value={config.resumeDelayMinutes} className={FIELD}
                onChange={(event) => patch({ resumeDelayMinutes: minutes(event.target.value, 0, 120) })} />
            </label>
            <label className="flex flex-col gap-1">
              Watch after suspend (min)
              <input type="number" min={1} max={60} value={config.guardMinutes} className={FIELD}
                onChange={(event) => patch({ guardMinutes: minutes(event.target.value, 1, 60) })} />
            </label>
            <label className="flex items-center gap-2 col-span-2">
              <input type="checkbox" checked={config.hardStopAtPct !== null}
                onChange={() => patch({ hardStopAtPct: config.hardStopAtPct === null ? 99 : null })} />
              Stop the agent if usage still rises past
              <input type="number" min={5} max={100} disabled={config.hardStopAtPct === null} value={config.hardStopAtPct ?? 99}
                aria-label="Hard stop percentage" className={`${FIELD} w-16`}
                onChange={(event) => patch({ hardStopAtPct: clampLimit(Number(event.target.value)) })} />%
            </label>
          </div>
          <div className="flex flex-col gap-1.5 text-xs text-theme-dim">
            <span className={LABEL}>Wake-up</span>
            <span>Sends one tiny prompt so a new session window starts on time. Only profiles open in a terminal are woken.</span>
            <div className="flex flex-wrap items-center gap-2">
              <select value={config.wake.mode} aria-label={`${AGENT_LABELS[agent]} wake-up schedule`} className={FIELD}
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
                  <input type="number" min={0} max={120} value={config.wake.delayMinutes} aria-label="Minutes after the reset" className={`${FIELD} w-16`}
                    onChange={(event) => patch({ wake: { ...config.wake, delayMinutes: minutes(event.target.value, 0, 120) } })} />
                  min
                </label>
              )}
            </div>
            {config.wake.mode !== 'off' && (
              <label className="flex flex-col gap-1">
                Prompt
                <input type="text" maxLength={120} value={config.wake.prompt} className={`${FIELD} ${promptValid ? '' : 'border-theme-error'}`}
                  onChange={(event) => patch({ wake: { ...config.wake, prompt: event.target.value } })} />
                {!promptValid && <span className="text-theme-error">Use letters, digits and simple punctuation only.</span>}
              </label>
            )}
          </div>
        </>
      )}
    </section>
  )
}
