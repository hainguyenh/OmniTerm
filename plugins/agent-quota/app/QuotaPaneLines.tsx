import { AlarmClock, ScanText, ShieldOff, SlidersHorizontal, Snowflake } from 'lucide-react'
import { useRef } from 'react'

import type { WindowKind } from '../src/types'

import './agentQuota.css'
import { QuotaOverridePopover } from './QuotaOverridePopover'
import { QuotaLine } from './QuotaLine'
import { effectiveConfig, pruneOverride, wakeConfigWithEnabled } from './quotaConfig'
import { isHeld } from './quotaGuard'
import { shouldHideWeekly } from './quotaPolicy'
import { clearManualPause, quotaCommands, setEditing, setOverride, setReviewSession, useCoarseNow, useQuota } from './quotaStore'
import { UsageReadCallout } from './UsageReadCallout'
import { AGENT_PROBES } from './usageProbeCore'

function WakeClockIcon({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return <AlarmClock className="w-3 h-3 text-theme-accent" />
  }
  return (
    <span className="relative inline-flex items-center justify-center w-3 h-3" data-testid="aq-wake-disabled-icon">
      <AlarmClock className="w-full h-full text-theme-dim opacity-70" />
      <svg viewBox="0 0 24 24" className="absolute inset-0 w-full h-full pointer-events-none" fill="none">
        <line x1="2" y1="2" x2="22" y2="22" stroke="var(--theme-bg, #181825)" strokeWidth="4.5" strokeLinecap="round" />
        <line x1="2" y1="2" x2="22" y2="22" stroke="var(--theme-error, #f7768e)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function SettingOverrideIcon({ custom }: { custom: boolean }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <SlidersHorizontal className="w-3 h-3" />
      {custom && (
        <span
          className="absolute -top-1 -right-1.5 flex items-center justify-center w-2.5 h-2.5 rounded-full bg-theme-accent text-theme-bg font-black text-[7px] leading-none pointer-events-none ring-1 ring-theme-bg shadow-sm"
          aria-hidden="true"
          data-testid="aq-setting-override-badge"
        >
          !
        </span>
      )}
    </span>
  )
}

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
  const awaitingUsage = useQuota((state) => sessionId in state.awaitingUsage)
  const pausedBtnRef = useRef<HTMLButtonElement | null>(null)
  const activeBtnRef = useRef<HTMLButtonElement | null>(null)
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
  const customBadge = display.icons.overrideBadge && !!override
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
          <button ref={pausedBtnRef} type="button" className={`aq-icon-button ${customBadge ? 'aq-override' : ''}`} aria-label="Quota settings for this terminal" onClick={() => setEditing(editing ? null : sessionId)}>
            <SettingOverrideIcon custom={customBadge} />
          </button>
        </div>
        {editing && <QuotaOverridePopover terminal={terminal} anchorRef={pausedBtnRef} />}
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
  const readUsageLabel = `Read quota from the ${AGENT_PROBES[terminal.agent].command} panel on screen`

  return (
    <div className={`aq-strip aq-size-${display.size}`} data-testid="aq-strip">
      <div className="aq-meta">
        <span className="aq-meta-name" title={terminal.profileName}>{terminal.profileName}</span>
        {display.icons.suspendState && held && (
          <button
            type="button"
            className="aq-icon-button p-0.5 text-theme-warning animate-pulse"
            aria-label="Suspended"
            title="Processes suspended. Click to review & manage threads"
            onClick={() => setReviewSession(sessionId)}
            data-testid="aq-frozen-indicator"
          >
            <Snowflake className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className={`aq-lines ${stale ? 'aq-stale' : ''}`} title={stale ? profile?.snapshot?.message : undefined}>
        {windows.length === 0 && (
          <span className="aq-lines-message">{profile?.snapshot?.error ? profile.snapshot.message ?? 'Quota unavailable' : rawWindows.length > 0 ? 'Quota within limits' : 'Reading quota…'}</span>
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
        <button
          type="button"
          className={`aq-icon-button ${held ? 'text-theme-warning' : ''}`}
          aria-label={held ? 'Review suspended processes' : 'Freeze processes for this profile'}
          aria-pressed={held}
          title={held ? 'Processes suspended. Click to review & manage threads' : 'Freeze all processes for this profile'}
          onClick={() => {
            if (held) {
              setReviewSession(sessionId)
            } else {
              quotaCommands().suspend(sessionId)
            }
          }}
          data-testid="aq-freeze-button"
        >
          <Snowflake className="w-3 h-3" />
        </button>
        {display.icons.wakeButton && (
          <button
            type="button"
            className={`aq-icon-button ${wakeEnabled ? 'text-theme-accent' : ''}`}
            aria-label={`${wakeEnabled ? 'Disable' : 'Enable'} scheduled wake-up for this terminal`}
            aria-pressed={wakeEnabled}
            title={`${wakeEnabled ? 'Disable' : 'Enable'} scheduled wake-up for this terminal`}
            onClick={toggleWake}
          >
            <WakeClockIcon enabled={wakeEnabled} />
          </button>
        )}
        <button
          type="button"
          className={`aq-icon-button ${awaitingUsage ? 'text-theme-accent' : ''}`}
          aria-label={readUsageLabel}
          aria-pressed={awaitingUsage}
          title={readUsageLabel}
          onClick={() => (awaitingUsage ? quotaCommands().cancelUsageRead(sessionId) : quotaCommands().readUsage(sessionId))}
        >
          <ScanText className={`w-3 h-3 ${awaitingUsage ? 'animate-pulse' : ''}`} />
        </button>
        {/* The settings button doubles as the custom-settings badge, so the meta slot after the
            profile name stays free for the agent icon. */}
        <button
          ref={activeBtnRef}
          type="button"
          className={`aq-icon-button ${customBadge ? 'aq-override' : ''}`}
          aria-label="Quota limits for this terminal"
          aria-description={customBadge ? 'Custom settings for this terminal' : undefined}
          title={customBadge ? 'Custom settings for this terminal' : undefined}
          aria-expanded={editing}
          onClick={() => setEditing(editing ? null : sessionId)}
        >
          <SettingOverrideIcon custom={customBadge} />
        </button>
      </div>
      {editing && <QuotaOverridePopover terminal={terminal} anchorRef={activeBtnRef} />}
      {awaitingUsage && <UsageReadCallout sessionId={sessionId} agent={terminal.agent} />}
    </div>
  )
}
