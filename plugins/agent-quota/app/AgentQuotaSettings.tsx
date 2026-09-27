import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'

import type { AgentKind, QuotaWindow } from '../src/types'
import type { AgentConfig, IconConfig, LineSize, PaceTier, QuotaConfig } from './quotaConfig'

import ToggleRow from '../../../ui/components/ToggleRow'
import './agentQuota.css'
import '../../../ui/components/customArtPreview.css'
import { isSafePrompt } from '../src/prompt'
import { AgentSettingsCard } from './AgentSettingsCard'
import { QuotaLine } from './QuotaLine'
import { HEADER_LOADING_ART, PACE_SLOTS, usePaceCustomArt } from './headerLoadingArt'
import { AGENT_KINDS, WINDOW_KINDS, WINDOW_LABELS } from './quotaConfig'
import { clearOverrides, quotaCommands, useQuota } from './quotaStore'

const LABEL = 'text-[10px] text-theme-fg uppercase font-bold tracking-widest'
const SIZES: LineSize[] = ['thin', 'normal', 'thick']
const ICONS: Array<{ key: keyof IconConfig; label: string }> = [
  { key: 'agent', label: 'Agent icon' },
  { key: 'overrideBadge', label: 'Custom / global badge' },
  { key: 'resetCountdown', label: 'Reset countdown' },
  { key: 'wakeButton', label: 'Scheduled wake button' },
  { key: 'suspendState', label: 'Suspended indicator' },
]
/** A preview line per zone at the default 90% limit, so the colours and animations are visible. */
const PREVIEW = [30, 55, 68, 76, 85, 95].map((usedPct): QuotaWindow => ({ kind: 'session', label: 'Preview', usedPct }))

interface AgentQuotaSettingsProps {
  sessionArtUrlLight?: string | null
  sessionArtUrlDark?: string | null
  refreshCustomArt?: () => void
}

type SessionArtSlot = 'session-light' | 'session-dark'

function promptsValid(config: QuotaConfig): boolean {
  return AGENT_KINDS.every((agent) => {
    const wake = config.agents[agent].wake
    return wake.mode === 'off' || isSafePrompt(wake.prompt)
  })
}

/**
 * The Settings → Agent Quota tab: global limits per agent, display options and the pin.
 *
 * Every field edits a local draft. Nothing reaches the engine, the pane bars, or disk until Apply —
 * so switching agents on/off, dragging a limit slider, or typing a wake prompt can't fire a save on
 * every keystroke, and a half-typed prompt can never be persisted.
 */
export default function AgentQuotaSettings({ sessionArtUrlLight = null, sessionArtUrlDark = null, refreshCustomArt = () => {} }: AgentQuotaSettingsProps) {
  const committed = useQuota((state) => state.config)
  const overrideCount = useQuota((state) => Object.keys(state.overrides).length)
  const now = useQuota((state) => state.now)
  const [draft, setDraft] = useState<QuotaConfig>(committed)
  const [resetOverridesToo, setResetOverridesToo] = useState(false)
  const [applied, setApplied] = useState(false)
  const appliedTimerRef = useRef<number | null>(null)
  const { paceArt, refresh: refreshPaceArt } = usePaceCustomArt()
  useEffect(() => () => { if (appliedTimerRef.current !== null) window.clearTimeout(appliedTimerRef.current) }, [])

  const dirty = JSON.stringify(draft) !== JSON.stringify(committed)
  const canApply = dirty && promptsValid(draft)
  const saveAgent = (agent: AgentKind, next: AgentConfig) =>
    setDraft((prev) => ({ ...prev, agents: { ...prev.agents, [agent]: next } }))
  const display = draft.display

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
    <div className="p-5 flex flex-col gap-4 text-theme-fg">
      <div className="flex flex-col gap-2">
        <ToggleRow
          label="Agent Quota"
          description="Show quota lines for AI agents in each terminal and guard their limits."
          checked={draft.enabled}
          onChange={() => setDraft({ ...draft, enabled: !draft.enabled })}
          ariaLabel="Enable Agent Quota"
        />
        <ToggleRow
          label="Pin to activity bar"
          description="Keep the quick-settings icon in the activity bar (shortcut: Agent Quota in Shortcuts)."
          checked={draft.pinned}
          onChange={() => setDraft({ ...draft, pinned: !draft.pinned })}
          ariaLabel="Pin Agent Quota to the activity bar"
        />
        <ToggleRow
          label="Custom session art"
          description="Use your own Light/Dark artwork in a busy terminal header. Off keeps the built-in tiered GIFs and hides upload controls."
          checked={draft.display.customArtSession}
          onChange={() => setDraft({ ...draft, display: { ...draft.display, customArtSession: !draft.display.customArtSession } })}
          ariaLabel="Use custom session artwork"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl border border-theme-border text-xs sticky top-0 bg-theme-bg z-10">
        {applied
          ? <span role="status" className="flex-1 text-theme-accent font-medium">Applied</span>
          : (
            <span className="flex-1 text-theme-dim">
              {dirty ? 'Unsaved changes' : 'No unsaved changes'}
            </span>
          )}
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
          {AGENT_KINDS.map((agent) => (
            <AgentSettingsCard key={agent} agent={agent} config={draft.agents[agent]} onChange={(next) => saveAgent(agent, next)} />
          ))}

          <section className="rounded-2xl border border-theme-border p-3 flex flex-col gap-3 text-xs" aria-label="Quota line display">
            <span className={LABEL}>Quota lines</span>
            <div className="flex items-center gap-2">
              <span className="text-theme-dim w-16">Size</span>
              {SIZES.map((size) => (
                <button key={size} type="button" aria-pressed={display.size === size}
                  onClick={() => setDraft({ ...draft, display: { ...display, size } })}
                  className={`px-2 py-1 rounded-lg border capitalize ${display.size === size ? 'border-theme-accent text-theme-accent' : 'border-theme-border'}`}
                >
                  {size}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-theme-dim w-16">Lines</span>
              {WINDOW_KINDS.map((kind) => (
                <label key={kind} className="flex items-center gap-1">
                  <input type="checkbox" checked={display.lines[kind]}
                    onChange={() => setDraft({ ...draft, display: { ...display, lines: { ...display.lines, [kind]: !display.lines[kind] } } })} />
                  {WINDOW_LABELS[kind].long}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-theme-dim w-16">Icons</span>
              {ICONS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-1">
                  <input type="checkbox" checked={display.icons[key]}
                    onChange={() => setDraft({ ...draft, display: { ...display, icons: { ...display.icons, [key]: !display.icons[key] } } })} />
                  {label}
                </label>
              ))}
            </div>
            <ToggleRow
              label="Warning animations"
              description="Lightning, fire, burning and danger as usage nears the limit. Off when the system asks for reduced motion."
              checked={display.animations}
              onChange={() => setDraft({ ...draft, display: { ...display, animations: !display.animations } })}
              ariaLabel="Quota warning animations"
            />
            <ToggleRow
              label="Auto-hide weekly when plenty remains"
              description={`Hide the weekly line when usage is below ${display.weeklyThresholdPct ?? 60}%. Only show when usage reaches this threshold.`}
              checked={display.weeklyAutoHide}
              onChange={() => setDraft({ ...draft, display: { ...display, weeklyAutoHide: !display.weeklyAutoHide } })}
              ariaLabel="Auto-hide the weekly line when plenty remains"
            />
            {display.weeklyAutoHide && (
              <div className="flex items-center gap-2 pl-4 -mt-1 text-xs">
                <span className="text-theme-dim">Show weekly when usage ≥</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={display.weeklyThresholdPct ?? 60}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(100, Number(e.target.value) || 0))
                    setDraft({ ...draft, display: { ...display, weeklyThresholdPct: val } })
                  }}
                  className="w-16 px-2 py-0.5 rounded border border-theme-border bg-theme-bg text-right font-mono"
                  aria-label="Weekly line visibility threshold percentage"
                />
                <span className="text-theme-dim">%</span>
              </div>
            )}
            <ToggleRow
              label="Pace glyph"
              description="Turtle, rabbit, plane or superman next to the 5h line, for how fast usage is on track to land by reset."
              checked={display.pace.enabled}
              onChange={() => setDraft({ ...draft, display: { ...display, pace: { ...display.pace, enabled: !display.pace.enabled } } })}
              ariaLabel="Show the usage pace glyph"
            />
            <div className={`aq-strip aq-size-${display.size} rounded-lg border border-theme-border`} aria-label="Preview">
              <div className="aq-lines">
                {PREVIEW.map((window) => (
                  <QuotaLine key={window.usedPct} window={window} limit={90} animations={display.animations} showReset={false} now={now} />
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {display.customArtSession && (
      <section className="rounded-2xl border border-theme-border p-3 flex flex-col gap-3 text-xs" aria-label="Custom agent session artwork">
        <div>
          <span className={LABEL}>Agent loading artwork</span>
          <p className="mt-1 text-[11px] leading-relaxed text-theme-dim">
            Built-in pace animations (4 types · 8 icons for Light and Dark modes). Upload custom images or GIFs below to override the header loading animation.
          </p>
        </div>

        {/* 4 tiers · 8 built-in icons & overrides */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase font-bold tracking-wider text-theme-dim">Built-in pace animations & overrides (4 types · 8 icons)</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['slow', 'onTrack', 'fast', 'overshooting'] as const).map((tier) => {
              const tierLabel = tier === 'slow' ? 'Slow' : tier === 'onTrack' ? 'On-track' : tier === 'fast' ? 'Fast' : 'Critical'
              const onRefresh = () => { refreshPaceArt(); refreshCustomArt() }
              const isCustom = Boolean(paceArt[tier].light || paceArt[tier].dark)
              return (
                <div key={tier} className="rounded-xl border border-theme-border overflow-hidden bg-theme-bg flex flex-col">
                  <div className="grid grid-cols-2 divide-x divide-theme-border">
                    <PaceSlotCard tier={tier} tierLabel={tierLabel} mode="light" customUrl={paceArt[tier].light} onRefresh={onRefresh} />
                    <PaceSlotCard tier={tier} tierLabel={tierLabel} mode="dark" customUrl={paceArt[tier].dark} onRefresh={onRefresh} />
                  </div>
                  <div className="px-2 py-1 border-t border-theme-border flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-theme-fg">{tierLabel}</span>
                    <span className="text-[8px] text-theme-dim uppercase">{isCustom ? 'Custom' : 'Default'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Speed and Zone/Size controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-theme-border">
          <div className="flex items-center gap-1.5">
            <span className="text-theme-dim text-[10px] font-bold uppercase tracking-wider">Speed</span>
            {(['slow', 'normal', 'fast'] as const).map((spd) => (
              <button
                key={spd}
                type="button"
                aria-pressed={(display.artSpeed ?? 'normal') === spd}
                onClick={() => setDraft({ ...draft, display: { ...draft.display, artSpeed: spd } })}
                className={`px-2 py-0.5 rounded-lg border text-[10px] ${
                  (display.artSpeed ?? 'normal') === spd ? 'border-theme-accent text-theme-accent font-semibold' : 'border-theme-border text-theme-dim hover:text-theme-fg'
                }`}
              >
                {spd === 'slow' ? 'Slow (0.6x)' : spd === 'normal' ? 'Normal (1x)' : 'Fast (1.6x)'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-theme-dim text-[10px] font-bold uppercase tracking-wider">Size</span>
            {(['compact', 'normal', 'large'] as const).map((sz) => (
              <button
                key={sz}
                type="button"
                aria-pressed={(display.artSize ?? 'normal') === sz}
                onClick={() => setDraft({ ...draft, display: { ...draft.display, artSize: sz } })}
                className={`px-2 py-0.5 rounded-lg border capitalize text-[10px] ${
                  (display.artSize ?? 'normal') === sz ? 'border-theme-accent text-theme-accent font-semibold' : 'border-theme-border text-theme-dim hover:text-theme-fg'
                }`}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>

        {/* Custom overrides */}
        <div className="flex flex-col gap-1.5 pt-2 border-t border-theme-border">
          <span className="text-[10px] uppercase font-bold tracking-wider text-theme-dim">Custom artwork overrides</span>
          <div className="grid grid-cols-2 gap-3">
            <SessionArtCard label="Light mode" url={sessionArtUrlLight} dark={false} onChanged={refreshCustomArt} />
            <SessionArtCard label="Dark mode" url={sessionArtUrlDark} dark onChanged={refreshCustomArt} />
          </div>
        </div>
      </section>
      )}
    </div>
  )
}

function SessionArtCard({ label, url, dark, onChanged }: { label: string; url: string | null; dark: boolean; onChanged: () => void }) {
  const [uploading, setUploading] = useState<SessionArtSlot | null>(null)
  const mode = dark ? 'dark' : 'light'
  const slot: SessionArtSlot = dark ? 'session-dark' : 'session-light'
  const upload = async () => {
    setUploading(slot)
    try {
      await window.omnitermAPI.customArt.upload(slot)
      onChanged()
    } catch {
      // User cancellation is a normal outcome for the file picker.
    } finally {
      setUploading(null)
    }
  }
  const remove = async () => {
    try {
      await window.omnitermAPI.customArt.remove(slot)
      onChanged()
    } catch {
      // Keep the current preview when the backend cannot remove the file.
    }
  }

  return (
    <div className="rounded-xl border border-theme-border overflow-hidden bg-theme-bg">
      <div className="art-preview-panel" data-art-mode={mode}>
        <span className="art-preview-panel__mode">{label}</span>
        <div className="art-preview-panel__canvas">
          <img
            src={url ?? HEADER_LOADING_ART.onTrack[mode]}
            alt={`${label} session artwork preview`}
            className="art-preview-panel__image"
          />
        </div>
        <span className="art-preview-panel__source">{url ? 'Custom' : 'Default · on-track'}</span>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-theme-border px-2 py-1.5">
        <span className="text-theme-dim">{label}</span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={`Upload ${label} session artwork`} onClick={() => void upload()} disabled={uploading !== null} className="inline-flex items-center gap-1 rounded border border-theme-border px-1.5 py-1 text-[10px] hover:border-theme-accent disabled:opacity-50">
            <ImagePlus className="h-3 w-3" /> {uploading ? 'Uploading…' : 'Upload'}
          </button>
          {url && <button type="button" onClick={() => void remove()} disabled={uploading !== null} className="inline-flex items-center rounded border border-theme-border p-1 text-theme-dim hover:border-theme-error hover:text-theme-error disabled:opacity-50" aria-label={`Remove ${label} custom session artwork`}>
            <Trash2 className="h-3 w-3" />
          </button>}
        </div>
      </div>
    </div>
  )
}

function PaceSlotCard({
  tier,
  tierLabel,
  mode,
  customUrl,
  onRefresh,
}: {
  tier: PaceTier
  tierLabel: string
  mode: 'light' | 'dark'
  customUrl: string | null
  onRefresh: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const slot = PACE_SLOTS[tier][mode]
  const alt = `${tierLabel} ${mode} mode artwork`

  const upload = async () => {
    setUploading(true)
    try {
      await window.omnitermAPI.customArt.upload(slot)
      onRefresh()
    } catch {
      // User cancelled file picker.
    } finally {
      setUploading(false)
    }
  }

  const remove = async () => {
    try {
      await window.omnitermAPI.customArt.remove(slot)
      onRefresh()
    } catch {
      // Keep current preview on removal error.
    }
  }

  return (
    <div className="art-preview-panel !min-h-[4.5rem] !p-1.5 flex flex-col justify-between" data-art-mode={mode}>
      <span className="art-preview-panel__mode text-[8px]">{mode}</span>
      <div className="art-preview-panel__canvas !h-8 my-1">
        <img
          src={customUrl ?? HEADER_LOADING_ART[tier][mode]}
          alt={alt}
          className="art-preview-panel__image max-h-7"
        />
      </div>
      <div className="flex items-center justify-center gap-1 w-full pt-1 border-t border-theme-border">
        <button
          type="button"
          aria-label={`Upload ${alt}`}
          onClick={() => void upload()}
          disabled={uploading}
          className="inline-flex items-center gap-1 rounded border border-theme-border px-1 py-0.5 text-[9px] hover:border-theme-accent disabled:opacity-50"
          title={`Upload ${alt}`}
        >
          <ImagePlus className="h-2.5 w-2.5" />
          <span>{uploading ? '…' : 'Upload'}</span>
        </button>
        {customUrl && (
          <button
            type="button"
            aria-label={`Remove custom ${alt}`}
            onClick={() => void remove()}
            disabled={uploading}
            className="inline-flex items-center rounded border border-theme-border p-0.5 text-theme-dim hover:border-theme-error hover:text-theme-error disabled:opacity-50"
            title={`Remove custom ${alt}`}
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  )
}

