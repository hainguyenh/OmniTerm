import { ImagePlus, Trash2 } from 'lucide-react'
import type React from 'react'
import { useRef, useState } from 'react'

import '../../../ui/components/customArtPreview.css'
import { ArtBlaze } from './ArtBlaze'
import { useArtDistanceFactor } from './artDistance'
import './headerBusyArt.css'
import { HEADER_LOADING_ART, PACE_SLOTS, resolvePaceArt, usePaceCustomArt } from './headerLoadingArt'
import type { ArtSize, ArtSpeed, DisplayConfig, PaceTier } from './quotaConfig'
import { PACE_TIERS } from './quotaConfig'
import { CompactSwitch, Segmented, SubHeading } from './settingsControls'

/** Tier names and the used ÷ limit range each one covers (quotaPolicy.headerLoadingTier). */
const TIERS: Record<PaceTier, { label: string; range: string }> = {
  slow: { label: 'Slow', range: '≤40% of limit' },
  onTrack: { label: 'On-track', range: '41–70%' },
  fast: { label: 'Fast', range: '71–85%' },
  overshooting: { label: 'Critical', range: '>85%' },
}
const SPEEDS: ReadonlyArray<{ value: ArtSpeed; text: string }> = [
  { value: 'slow', text: 'Slow (0.6x)' },
  { value: 'normal', text: 'Normal (1x)' },
  { value: 'fast', text: 'Fast (1.6x)' },
]
const ART_SIZES: ReadonlyArray<{ value: ArtSize; text: string }> = [
  { value: 'compact', text: 'compact' },
  { value: 'normal', text: 'normal' },
  { value: 'large', text: 'large' },
]
const MODES: ReadonlyArray<{ value: 'light' | 'dark'; text: string }> = [
  { value: 'dark', text: 'dark' },
  { value: 'light', text: 'light' },
]

/**
 * The "Loading artwork" group: whether a busy agent pane's header shows animated artwork (off keeps
 * the plain running dots), one card per quota tier with a Light and a Dark slot to upload over the
 * built-in GIF, the speed and size, and a live preview of all four tiers as the header draws them.
 */
export function LoadingArtSettings({ display, onChange, refreshCustomArt }: {
  display: DisplayConfig
  onChange: (display: DisplayConfig) => void
  refreshCustomArt: () => void
}) {
  const { paceArt, refresh: refreshPaceArt } = usePaceCustomArt()
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('dark')
  const speed = display.artSpeed ?? 'normal'
  const size = display.artSize ?? 'normal'
  const onRefresh = () => { refreshPaceArt(); refreshCustomArt() }

  return (
    <div className="flex flex-col gap-3 text-xs">
      <CompactSwitch
        label="Agent loading artwork"
        note={display.customArtSession ? 'animated art while an agent works' : 'off: plain running dots'}
        hint="Shown in a busy agent pane's header. The tier follows how much of the 5h limit is used."
        checked={display.customArtSession}
        onChange={() => onChange({ ...display, customArtSession: !display.customArtSession })}
        ariaLabel="Show agent loading artwork"
      />
      {display.customArtSession && (
        <section className="flex flex-col gap-3" aria-label="Custom agent session artwork">
          <div className="flex flex-col gap-1.5">
            <SubHeading hint="Upload an image or GIF on any slot to replace that built-in animation; the bin brings the built-in back.">Tiers</SubHeading>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PACE_TIERS.map((tier) => (
                <div key={tier} className="rounded-xl border border-theme-border overflow-hidden bg-theme-bg flex flex-col">
                  <div className="grid grid-cols-2 divide-x divide-theme-border">
                    <PaceSlotCard tier={tier} mode="light" customUrl={paceArt[tier].light} onRefresh={onRefresh} />
                    <PaceSlotCard tier={tier} mode="dark" customUrl={paceArt[tier].dark} onRefresh={onRefresh} />
                  </div>
                  <div className="px-2 py-1 border-t border-theme-border flex items-center justify-between gap-1 text-[10px]">
                    <span className="font-semibold text-theme-fg">{TIERS[tier].label}</span>
                    <span className="text-theme-dim tabular-nums">{TIERS[tier].range}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <SubHeading>Motion</SubHeading>
            <Segmented label="Speed" options={SPEEDS} value={speed} onChange={(artSpeed) => onChange({ ...display, artSpeed })} />
            <Segmented label="Size" options={ART_SIZES} value={size} onChange={(artSize) => onChange({ ...display, artSize })} />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <SubHeading>Preview</SubHeading>
              <Segmented label="" options={MODES} value={previewMode} onChange={setPreviewMode} />
            </div>
            <div className="art-preview-panel !block !p-1.5 rounded-lg border border-theme-border" data-art-mode={previewMode} aria-label="Loading artwork preview">
              {PACE_TIERS.map((tier) => (
                <div key={tier} className="flex items-center gap-2 h-6">
                  <span className="w-14 shrink-0 text-[10px] font-semibold">{TIERS[tier].label}</span>
                  <span className="relative flex-1 self-stretch">
                    <ArtPreviewItem
                      tier={tier}
                      size={size}
                      speed={speed}
                      previewMode={previewMode}
                      paceArt={paceArt}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function ArtPreviewItem({
  tier,
  size,
  speed,
  previewMode,
  paceArt,
}: {
  tier: PaceTier
  size: ArtSize
  speed: ArtSpeed
  previewMode: 'light' | 'dark'
  paceArt: Record<PaceTier, { light: string | null; dark: string | null }>
}) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const distanceFactor = useArtDistanceFactor(containerRef)
  const isBlazing = tier === 'overshooting'
  const blazingClass = isBlazing ? ' aq-busy-art-blazing' : ''
  return (
    <span
      ref={containerRef}
      className={`aq-busy-art aq-busy-art-${tier} aq-art-size-${size} aq-art-speed-${speed}${blazingClass}`}
      data-testid={`art-preview-${tier}`}
      data-blazing={isBlazing ? 'true' : undefined}
      style={distanceFactor !== undefined ? ({ '--aq-art-distance-factor': distanceFactor } as React.CSSProperties) : undefined}
    >
      <img src={resolvePaceArt(tier, previewMode, paceArt)} alt="" aria-hidden="true" draggable="false" />
      {isBlazing && <ArtBlaze />}
    </span>
  )
}

function PaceSlotCard({ tier, mode, customUrl, onRefresh }: {
  tier: PaceTier
  mode: 'light' | 'dark'
  customUrl: string | null
  onRefresh: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const slot = PACE_SLOTS[tier][mode]
  const alt = `${TIERS[tier].label} ${mode} mode artwork`

  const upload = async () => {
    setUploading(true)
    try {
      await window.omnitermAPI.customArt.upload(slot)
      onRefresh()
    } catch {
      // User cancelled the file picker.
    } finally {
      setUploading(false)
    }
  }

  const remove = async () => {
    try {
      await window.omnitermAPI.customArt.remove(slot)
      onRefresh()
    } catch {
      // Keep the current preview on a removal error.
    }
  }

  return (
    <div className="art-preview-panel !min-h-[4rem] !p-1 flex flex-col justify-between" data-art-mode={mode}>
      <span className="art-preview-panel__mode text-[8px]">{mode}</span>
      <div className="art-preview-panel__canvas !h-8 my-1">
        <img src={customUrl ?? HEADER_LOADING_ART[tier][mode]} alt={alt} className="art-preview-panel__image max-h-7" />
      </div>
      <div className="flex items-center justify-center gap-1 w-full pt-1 border-t border-theme-border">
        <button
          type="button"
          aria-label={`Upload ${alt}`}
          title={`Upload ${alt}`}
          onClick={() => void upload()}
          disabled={uploading}
          className="inline-flex items-center gap-1 rounded border border-theme-border px-1 py-0.5 text-[9px] hover:border-theme-accent disabled:opacity-50"
        >
          <ImagePlus className="h-2.5 w-2.5" />
          <span>{uploading ? '…' : customUrl ? 'Replace' : 'Upload'}</span>
        </button>
        {customUrl && (
          <button
            type="button"
            aria-label={`Remove custom ${alt}`}
            title={`Remove custom ${alt}`}
            onClick={() => void remove()}
            disabled={uploading}
            className="inline-flex items-center rounded border border-theme-border p-0.5 text-theme-dim hover:border-theme-error hover:text-theme-error disabled:opacity-50"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  )
}
