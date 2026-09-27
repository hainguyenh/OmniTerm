import { AlarmClock, ShieldOff, SlidersHorizontal, Snowflake } from 'lucide-react'

import type { WindowKind } from '../src/types'

import './agentQuota.css'
import { QuotaOverridePopover } from './QuotaOverridePopover'
import { QuotaLine } from './QuotaLine'
import { effectiveConfig, pruneOverride, wakeConfigWithEnabled } from './quotaConfig'
import { isHeld } from './quotaGuard'
import { shouldHideWeekly } from './quotaPolicy'
import { clearManualPause, setEditing, setOverride, useCoarseNow, useQuota } from './quotaStore'

/**
 * The quota strip above one terminal: one line per window the provider reports (session, weekly,
 * monthly), coloured by how close each is to its limit. A paused terminal keeps a visible resume
 * affordance so the user can turn monitoring back on for that exact agent process.
 */
export function QuotaPaneLines({ sessionId }: { sessionId: string }) {
  const terminal = useQuota((state) => state.terminals[sessionId])
  const enabled = useQuota((state) => state.config.enabled)
  const display = useQuota((state) => state.config.display)
  const global = useQuota((state) => (terminal ? state.config.agents[terminal.agent] : undefined))
  const profile = useQuota((state) => (terminal ? state.profiles[terminal.profileKey] : undefined))
  const override = useQuota((state) => (terminal ? state.overrides[terminal.instanceKey] : undefined))
  const guard = useQuota((state) => (terminal ? state.guards[terminal.instanceKey] : undefined))
  const editing = useQuota((state) => state.editing === sessionId)
  const rawWindows = profile?.lastGood?.windows ?? []
  // Second-level precision only once something this strip shows is about to reset; otherwise this
  // pane re-renders on a 30s cadence instead of every tick of the shared clock.
  const nearestDeadline = rawWindows.reduce<number | undefined>(
    (soonest, window) => window.resetsAt !== undefined && (soonest === undefined || window.resetsAt < soonest) ? window.resetsAt : soonest,
    undefined,
  )
  const now = useCoarseNow(nearestDeadline)
  if (!enabled) {
    return (
      <div className="aq-monitor-off-strip" data-testid="aq-monitor-off" role="status">
        <span className="aq-monitor-off-icon" aria-hidden="true"><ShieldOff /></span>
        <span>Quota monitor off</span>
      </div>
    )
  }
  if (!terminal || !global) return null

  const config = effectiveConfig(global, override)
  const enableMonitoring = () => {
    setOverride(terminal.instanceKey, pruneOverride(global, { ...override, enabled: true }))
    clearManualPause(terminal.instanceKey)
  }
  if (!config.enabled) {
    return (
      <div className="relative">
        <div className="aq-monitor-off-strip" data-testid="aq-monitor-paused" role="status">
          <span className="aq-monitor-off-icon" aria-hidden="true"><ShieldOff /></span>
          <span className="flex-1 min-w-0 truncate">Monitoring paused for this terminal</span>
          <button type="button" className="aq-monitor-enable" onClick={enableMonitoring}>Enable monitoring</button>
          <button type="button" className="aq-icon-button" aria-label="Quota settings for this terminal" onClick={() => setEditing(sessionId)}>
            <SlidersHorizontal className="w-3 h-3" />
          </button>
        </div>
        {editing && <QuotaOverridePopover terminal={terminal} />}
      </div>
    )
  }
  const stale = !!profile?.snapshot?.error
  const weeklyWindow = rawWindows.find((window) => window.kind === 'weekly')
  // The terminal's "Show weekly quota" override beats the global auto-hide.
  const weeklyHidden = !override?.showWeekly && display.weeklyAutoHide && !!weeklyWindow
    && shouldHideWeekly(weeklyWindow, display.weeklyThresholdPct ?? 60)
  const windows = rawWindows
    .filter((window) => display.lines[window.kind])
    .filter((window) => !(window.kind === 'weekly' && weeklyHidden))
  const wakeEnabled = config.wake.mode !== 'off'
  const setLimit = (kind: WindowKind) => (limit: number) =>
    setOverride(terminal.instanceKey, pruneOverride(global, { ...override, limits: { ...override?.limits, [kind]: limit } }))
  const toggleWake = () => setOverride(
    terminal.instanceKey,
    pruneOverride(global, { ...override, wake: wakeConfigWithEnabled(global, config, !wakeEnabled) }),
  )
  const held = isHeld(guard)

  return (
    <div className={`aq-strip aq-size-${display.size}`} data-testid="aq-strip">
      <div className="aq-meta">
        <span className="aq-meta-name" title={terminal.profileName}>{terminal.profileName}</span>
        {display.icons.overrideBadge && override && (
          <SlidersHorizontal className="w-3 h-3 aq-override" aria-label="Custom settings for this terminal" />
        )}
        {display.icons.suspendState && held && <Snowflake className="w-3 h-3 text-theme-warning" aria-label="Suspended" />}
      </div>
      <div className={`aq-lines ${stale ? 'aq-stale' : ''}`} title={stale ? profile?.snapshot?.message : undefined}>
        {windows.length === 0 && (
          <span>{profile?.snapshot?.error ? profile.snapshot.message ?? 'Quota unavailable' : 'Reading quota…'}</span>
        )}
        {windows.map((window) => (
          <QuotaLine
            key={window.kind}
            window={window}
            limit={config.limits[window.kind]}
            animations={display.animations}
            showReset={display.icons.resetCountdown}
            now={now}
            onLimitChange={setLimit(window.kind)}
            size={display.size}
            tooltipSuffix={window.kind === 'session' && weeklyHidden && weeklyWindow
              ? `Weekly: ${Math.round(weeklyWindow.usedPct)}% used (hidden)`
              : undefined}
          />
        ))}
      </div>
      <div className="aq-actions flex items-center gap-0.5">
        {display.icons.wakeButton && (
          <button
            type="button"
            className={`aq-icon-button ${wakeEnabled ? 'text-theme-accent' : ''}`}
            aria-label={`${wakeEnabled ? 'Disable' : 'Enable'} scheduled wake-up for this terminal`}
            aria-pressed={wakeEnabled}
            title={`${wakeEnabled ? 'Disable' : 'Enable'} scheduled wake-up for this terminal`}
            onClick={toggleWake}
          >
            <AlarmClock className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          className="aq-icon-button"
          aria-label="Quota limits for this terminal"
          aria-expanded={editing}
          onClick={() => setEditing(editing ? null : sessionId)}
        >
          <SlidersHorizontal className="w-3 h-3" />
        </button>
      </div>
      {editing && <QuotaOverridePopover terminal={terminal} />}
    </div>
  )
}
