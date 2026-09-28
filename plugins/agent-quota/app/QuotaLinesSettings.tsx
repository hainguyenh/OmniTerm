import type { QuotaWindow } from '../src/types'
import type { DisplayConfig, IconConfig, LineSize } from './quotaConfig'

import { QuotaLine } from './QuotaLine'
import { WINDOW_KINDS, WINDOW_LABELS } from './quotaConfig'
import { CompactSwitch, FIELD, Segmented, SubHeading } from './settingsControls'

const SIZES: ReadonlyArray<{ value: LineSize; text: string }> = [
  { value: 'thin', text: 'thin' },
  { value: 'normal', text: 'normal' },
  { value: 'thick', text: 'thick' },
]
const ICONS: Array<{ key: keyof IconConfig; label: string }> = [
  { key: 'agent', label: 'Agent icon' },
  { key: 'overrideBadge', label: 'Custom / global badge' },
  { key: 'resetCountdown', label: 'Reset countdown' },
  { key: 'wakeButton', label: 'Scheduled wake button' },
  { key: 'suspendState', label: 'Suspended indicator' },
]
/** A preview line per zone at the default 90% limit, so the colours and animations are visible. */
const PREVIEW = [30, 55, 68, 76, 85, 95].map((usedPct): QuotaWindow => ({ kind: 'session', label: 'Preview', usedPct }))

/**
 * The "Quota lines" group: how each terminal's quota strip looks — size, which windows, which
 * icons, the warning animations, weekly auto-hide and the pace glyph — above a live preview of the
 * draft.
 */
export function QuotaLinesSettings({ display, onChange, now }: {
  display: DisplayConfig
  onChange: (display: DisplayConfig) => void
  now: number
}) {
  const threshold = display.weeklyThresholdPct ?? 60
  return (
    <section className="flex flex-col gap-3 text-xs" aria-label="Quota line display">
      <div className="flex flex-col gap-1.5">
        <SubHeading>Look</SubHeading>
        <Segmented label="Size" options={SIZES} value={display.size} onChange={(size) => onChange({ ...display, size })} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-14 text-theme-dim">Lines</span>
          {WINDOW_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-1">
              <input type="checkbox" checked={display.lines[kind]}
                onChange={() => onChange({ ...display, lines: { ...display.lines, [kind]: !display.lines[kind] } })} />
              {WINDOW_LABELS[kind].long}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-14 text-theme-dim">Icons</span>
          {ICONS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1">
              <input type="checkbox" checked={display.icons[key]}
                onChange={() => onChange({ ...display, icons: { ...display.icons, [key]: !display.icons[key] } })} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        <SubHeading>Behaviour</SubHeading>
        <CompactSwitch
          label="Warning animations"
          note="lightning, fire and danger near the limit"
          hint="Off when the system asks for reduced motion."
          checked={display.animations}
          onChange={() => onChange({ ...display, animations: !display.animations })}
          ariaLabel="Quota warning animations"
        />
        <CompactSwitch
          label="Pace glyph"
          note="turtle → superman beside the 5h line"
          hint="How fast usage is on track to land by the reset."
          checked={display.pace.enabled}
          onChange={() => onChange({ ...display, pace: { ...display.pace, enabled: !display.pace.enabled } })}
          ariaLabel="Show the usage pace glyph"
        />
        <CompactSwitch
          label="Auto-hide weekly quota"
          note={`while under ${threshold}%`}
          hint={'A terminal can still show it: its quota settings have "Show weekly quota".'}
          checked={display.weeklyAutoHide}
          onChange={() => onChange({ ...display, weeklyAutoHide: !display.weeklyAutoHide })}
          ariaLabel="Auto-hide the weekly line when plenty remains"
        />
        {display.weeklyAutoHide && (
          <label className="flex items-center gap-2 pl-3 text-theme-dim">
            Hide while weekly usage &lt;
            <input
              type="number"
              min={0}
              max={100}
              value={threshold}
              onChange={(event) => onChange({ ...display, weeklyThresholdPct: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })}
              className={`${FIELD} w-16 py-0.5 text-right font-mono`}
              aria-label="Auto-hide weekly while usage is below this percentage"
            />
            %
          </label>
        )}
      </div>

      <div className={`aq-strip aq-size-${display.size} rounded-lg border border-theme-border`} aria-label="Preview">
        <div className="aq-lines">
          {PREVIEW.map((window) => (
            <QuotaLine key={window.usedPct} window={window} limit={90} animations={display.animations} showReset={false} now={now} />
          ))}
        </div>
      </div>
    </section>
  )
}
