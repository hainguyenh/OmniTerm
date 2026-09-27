import { AlarmClock, Check, Globe, Play, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { WindowKind } from '../src/types'
import type { AgentOverride, WakeMode } from './quotaConfig'
import type { TerminalAgent } from './quotaStore'

import ToggleRow from '../../../ui/components/ToggleRow'
import { confirmDisableSuspend, confirmResumeNow } from './dangerConfirm'
import { isSafePrompt } from '../src/prompt'
import { AGENT_LABELS, clampLimit, effectiveConfig, pruneOverride, wakeConfigWithEnabled, WINDOW_LABELS } from './quotaConfig'
import { isHeld } from './quotaGuard'
import { clearManualPause, setEditing, setOverride, useQuota } from './quotaStore'

const WAKE_MODES: Array<{ id: WakeMode; label: string }> = [
  { id: 'off', label: 'Off' },
  { id: 'afterReset', label: 'After each session reset' },
  { id: 'timeOfDay', label: 'Every day at a time' },
]

const FIELD = 'bg-theme-bg border border-theme-border rounded-lg text-xs text-theme-fg px-2 py-1 focus:outline-none focus:border-theme-accent'

/**
 * This terminal's own limits. Changes create a sparse, in-memory override tied to the running
 * agent process; it is never written to settings and disappears when the agent exits.
 */
export function QuotaOverridePopover({ terminal }: { terminal: TerminalAgent }) {
  const global = useQuota((state) => state.config.agents[terminal.agent])
  const committed = useQuota((state) => state.overrides[terminal.instanceKey])
  const guard = useQuota((state) => state.guards[terminal.instanceKey])
  const windows = useQuota((state) => state.profiles[terminal.profileKey]?.lastGood?.windows)
  // Edits land in a local draft first — nothing here reaches the running engine until Apply, so
  // dragging a slider can't misfire a suspend/resume decision on a half-typed prompt.
  const [draft, setDraft] = useState<AgentOverride | undefined>(committed)
  const [applied, setApplied] = useState(false)
  const appliedTimerRef = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => { if (appliedTimerRef.current !== null) window.clearTimeout(appliedTimerRef.current) }, [])
  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setEditing(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditing(null)
    }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const config = effectiveConfig(global, draft)
  const committedConfig = effectiveConfig(global, committed)
  const kinds: WindowKind[] = windows && windows.length > 0 ? windows.map((window) => window.kind) : ['session', 'weekly']
  const wakeEnabled = config.wake.mode !== 'off'
  const hasWakeOverride = draft?.wake !== undefined
  const promptValid = !wakeEnabled || isSafePrompt(config.wake.prompt)
  const pruned = pruneOverride(global, draft ?? {})
  const dirty = JSON.stringify(pruned) !== JSON.stringify(committed ?? null)

  const apply = (patch: AgentOverride) => {
    setDraft((prev) => ({ ...prev, ...patch, limits: { ...prev?.limits, ...patch.limits } }))
  }

  const toggleSuspend = () => {
    if (config.suspendAtLimit) confirmDisableSuspend(`${AGENT_LABELS[terminal.agent]} in this terminal`, () => apply({ suspendAtLimit: false }))
    else apply({ suspendAtLimit: true })
  }

  const handleApply = () => {
    if (!promptValid) return
    setOverride(terminal.instanceKey, pruned)
    if (!committedConfig.enabled && config.enabled) clearManualPause(terminal.instanceKey)
    setApplied(true)
    appliedTimerRef.current = window.setTimeout(() => setApplied(false), 2000)
  }

  const handleReset = () => setDraft(committed)
  const handleCancel = () => { setDraft(committed); setEditing(null) }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Quota limits for this terminal"
      className="absolute right-2 top-full mt-1 z-30 w-72 p-3 rounded-xl border border-theme-border bg-theme-popup shadow-2xl text-xs text-theme-fg flex flex-col gap-2.5"
    >
      <div className="flex items-center gap-2">
        {pruned ? <SlidersHorizontal className="w-3.5 h-3.5 aq-override" /> : <Globe className="w-3.5 h-3.5 text-theme-dim" />}
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{AGENT_LABELS[terminal.agent]} · {terminal.profileName}</div>
          <div className="text-[10px] text-theme-dim">{pruned ? 'Custom settings for this session' : 'Using global settings'}</div>
        </div>
        <button type="button" aria-label="Close" className="aq-icon-button" onClick={handleCancel}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {kinds.map((kind) => (
        <label key={kind} className="flex items-center gap-2">
          <span className="w-20 text-theme-dim">{WINDOW_LABELS[kind].long}</span>
          <input
            type="range"
            min={5}
            max={100}
            value={config.limits[kind]}
            aria-label={`${WINDOW_LABELS[kind].long} limit for this terminal`}
            onChange={(event) => apply({ limits: { [kind]: clampLimit(Number(event.target.value)) } })}
            className="flex-1 accent-[var(--theme-accent)]"
          />
          <span className="w-9 text-right tabular-nums">{config.limits[kind]}%</span>
        </label>
      ))}

      <ToggleRow
        label="Monitor this terminal"
        description={config.enabled ? 'Quota reads and guard actions are active for this agent process.' : 'Paused for this agent process until you enable it again.'}
        checked={config.enabled}
        onChange={() => apply({ enabled: !config.enabled })}
        ariaLabel="Monitor this terminal's agent"
      />

      <ToggleRow
        label="Suspend at limit"
        description="Freeze this agent and its sub-agents when a limit is reached."
        checked={config.suspendAtLimit}
        onChange={toggleSuspend}
        ariaLabel="Suspend this terminal's agent at its limit"
      />
      <ToggleRow
        label="Resume after reset"
        description="Thaw automatically once the window resets."
        checked={config.autoResume}
        onChange={() => apply({ autoResume: !config.autoResume })}
        ariaLabel="Resume this terminal's agent after the reset"
      />

      <section className="flex flex-col gap-2 border-t border-theme-border pt-2" aria-label="Wake-up settings for this terminal">
        <ToggleRow
          icon={<AlarmClock className="w-3.5 h-3.5" />}
          label="Scheduled wake-up"
          description={hasWakeOverride ? 'Custom schedule for this terminal.' : wakeEnabled ? 'Inherited from global settings.' : 'Off globally; enable it for this terminal.'}
          checked={wakeEnabled}
          onChange={() => apply({ wake: wakeConfigWithEnabled(global, config, !wakeEnabled) })}
          ariaLabel="Enable scheduled wake-up for this terminal"
        />
        <div className="flex flex-col gap-1.5 text-[11px] text-theme-dim">
          <label className="flex items-center gap-2">
            <span className="w-16">Schedule</span>
            <select
              value={config.wake.mode}
              aria-label="Terminal wake-up schedule"
              className={`${FIELD} flex-1 min-w-0`}
              onChange={(event) => apply({ wake: { ...config.wake, mode: event.target.value as WakeMode } })}
            >
              {WAKE_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
            </select>
          </label>
          {config.wake.mode === 'timeOfDay' && (
            <label className="flex items-center gap-2">
              <span className="w-16">Wake time</span>
              <input
                type="time"
                value={config.wake.time}
                aria-label="Terminal wake time"
                className={FIELD}
                onChange={(event) => event.target.value && apply({ wake: { ...config.wake, time: event.target.value } })}
              />
            </label>
          )}
          {config.wake.mode === 'afterReset' && (
            <label className="flex items-center gap-2">
              <span className="w-16">Delay</span>
              <input
                type="number"
                min={0}
                max={120}
                value={config.wake.delayMinutes}
                aria-label="Terminal minutes after the reset"
                className={`${FIELD} w-16`}
                onChange={(event) => apply({ wake: { ...config.wake, delayMinutes: Math.min(120, Math.max(0, Math.round(Number(event.target.value) || 0))) } })}
              />
              <span>min after reset</span>
            </label>
          )}
          {wakeEnabled && (
            <label className="flex items-center gap-2">
              <span className="w-16">Prompt</span>
              <input
                type="text"
                maxLength={120}
                value={config.wake.prompt}
                aria-label="Terminal wake prompt"
                className={`${FIELD} flex-1 min-w-0 ${isSafePrompt(config.wake.prompt) ? '' : 'border-theme-error'}`}
                onChange={(event) => apply({ wake: { ...config.wake, prompt: event.target.value } })}
              />
            </label>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={!pruned}
          onClick={() => setDraft(undefined)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-theme-border hover:border-theme-accent disabled:opacity-40"
        >
          <RotateCcw className="w-3 h-3" /> Reset to global
        </button>
        {isHeld(guard) && (
          <button
            type="button"
            onClick={() => confirmResumeNow(terminal)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-theme-warning text-theme-warning"
          >
            <Play className="w-3 h-3" /> Resume now
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-theme-border pt-2">
        {applied && (
          <span role="status" className="flex items-center gap-1 text-[11px] text-theme-accent">
            <Check className="w-3 h-3" /> Applied
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCancel}
            className="px-2.5 py-1 rounded-lg border border-theme-border hover:border-theme-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={handleReset}
            className="px-2.5 py-1 rounded-lg border border-theme-border hover:border-theme-accent disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            disabled={!dirty || !promptValid}
            onClick={handleApply}
            title={!promptValid ? 'Fix the wake prompt before applying' : undefined}
            className="px-2.5 py-1 rounded-lg bg-theme-accent text-theme-accent-fg font-semibold disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
