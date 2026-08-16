import React, { useState } from 'react'
import { ImagePlus, RotateCcw, Info, Save } from 'lucide-react'
import { DefaultIdleArt, DefaultLoadingArt } from '../assets/defaultArt'
import { Tooltip } from './Tooltip'

/**
 * Settings section for uploading custom pane art (idle + loading).
 *
 * Users can upload their own images/GIFs for the idle pane and connecting overlay, replacing the
 * built-in defaults. Uploaded files are stored in the app data directory by the Rust backend.
 *
 * The section is collapsed by default to save space.
 */

interface CustomArtSettingsProps {
  /** Current custom art URLs (null = use defaults). */
  idleArtUrlLight: string | null
  idleArtUrlDark: string | null
  loadingArtUrlLight: string | null
  loadingArtUrlDark: string | null
  /** Called after upload/remove so the parent refreshes its state. */
  onArtChanged: () => void
}

type ArtSlot = 'idle-light' | 'idle-dark' | 'loading-light' | 'loading-dark'

const CustomArtSettings: React.FC<CustomArtSettingsProps> = ({
  idleArtUrlLight, idleArtUrlDark, loadingArtUrlLight, loadingArtUrlDark, onArtChanged,
}) => {
  const [uploading, setUploading] = useState<ArtSlot | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)

  /** Tracks which slots have unsaved changes (freshly uploaded this session). */
  const [pendingSlots, setPendingSlots] = useState<Set<ArtSlot>>(new Set())

  const handleUpload = async (slot: ArtSlot) => {
    setUploading(slot)
    try {
      await window.omnitermAPI.customArt.upload(slot)
      setPendingSlots(prev => new Set(prev).add(slot))
      onArtChanged()
    } catch {
      // User cancelled the dialog or an error occurred — silently ignore.
    } finally {
      setUploading(null)
    }
  }

  const handleRemove = async (slot: ArtSlot) => {
    try {
      await window.omnitermAPI.customArt.remove(slot)
      setPendingSlots(prev => {
        const next = new Set(prev)
        next.delete(slot)
        return next
      })
      onArtChanged()
    } catch {
      // Ignore
    }
  }

  const handleSave = () => {
    // Refresh to ensure the latest art is loaded everywhere, then clear pending state.
    onArtChanged()
    setPendingSlots(new Set())
  }

  const hasAnyCustom = !!(idleArtUrlLight || idleArtUrlDark || loadingArtUrlLight || loadingArtUrlDark)
  const hasPendingChanges = pendingSlots.size > 0

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-theme-fg uppercase tracking-wider">Custom Pane Art</h3>
          <p className="text-[11px] text-theme-dim leading-relaxed mt-0.5">
            Upload custom images or GIFs for idle and loading panes in Light and Dark modes (max 2 MB).
          </p>
        </div>

        {/* Info icon with tooltip */}
        <div className="relative">
          <Tooltip content="Upload custom images (max 2 MB) for idle and loading panes" placement="bottom">
            <button
              type="button"
              className="p-1 text-theme-dim hover:text-theme-accent transition-colors bg-transparent border-none cursor-help rounded-lg hover:bg-white/5"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              onClick={(e) => { e.stopPropagation(); setShowTooltip(v => !v) }}
              aria-label="Pane Art info"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          {showTooltip && (
            <div className="absolute right-0 top-full mt-1 z-50 w-56 px-2.5 py-2 rounded-lg bg-[var(--theme-popup-bg)] border border-theme-border shadow-xl text-[10px] text-theme-fg leading-relaxed pointer-events-none">
              Upload custom images or GIFs to replace the default idle and loading pane art. Light and Dark mode each have separate slots. Max file size: 2 MB.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-theme-border pt-3">
        <ArtCard
          label="Idle (Light)"
          description="Empty panes in Light theme"
          customUrl={idleArtUrlLight}
          defaultPreview={<DefaultIdleArt dark={false} />}
          uploading={uploading === 'idle-light'}
          isPending={pendingSlots.has('idle-light')}
          onUpload={() => handleUpload('idle-light')}
          onRemove={() => handleRemove('idle-light')}
        />

        <ArtCard
          label="Idle (Dark)"
          description="Empty panes in Dark theme"
          customUrl={idleArtUrlDark}
          defaultPreview={<DefaultIdleArt dark={true} />}
          uploading={uploading === 'idle-dark'}
          isPending={pendingSlots.has('idle-dark')}
          onUpload={() => handleUpload('idle-dark')}
          onRemove={() => handleRemove('idle-dark')}
        />

        <ArtCard
          label="Loading (Light)"
          description="Connecting in Light theme"
          customUrl={loadingArtUrlLight}
          defaultPreview={<DefaultLoadingArt dark={false} />}
          uploading={uploading === 'loading-light'}
          isPending={pendingSlots.has('loading-light')}
          onUpload={() => handleUpload('loading-light')}
          onRemove={() => handleRemove('loading-light')}
        />

        <ArtCard
          label="Loading (Dark)"
          description="Connecting in Dark theme"
          customUrl={loadingArtUrlDark}
          defaultPreview={<DefaultLoadingArt dark={true} />}
          uploading={uploading === 'loading-dark'}
          isPending={pendingSlots.has('loading-dark')}
          onUpload={() => handleUpload('loading-dark')}
          onRemove={() => handleRemove('loading-dark')}
        />
      </div>

      {/* Save button — shown when there are pending uploads to confirm */}
      {(hasPendingChanges || hasAnyCustom) && (
        <div className="mt-1 flex items-center gap-2">
          <Tooltip content="Apply and save custom artwork changes" placement="top">
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasPendingChanges}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-colors ${
                hasPendingChanges
                  ? 'bg-theme-accent text-theme-accent-fg border-theme-accent hover:opacity-90'
                  : 'bg-theme-bg text-theme-dim border-theme-border cursor-default opacity-50'
              }`}
            >
              <Save className="w-3 h-3" />
              {hasPendingChanges ? `Save Changes (${pendingSlots.size})` : 'All Saved'}
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

interface ArtCardProps {
  label: string
  description: string
  customUrl: string | null
  defaultPreview: React.ReactNode
  uploading: boolean
  isPending: boolean
  onUpload: () => void
  onRemove: () => void
}

const ArtCard: React.FC<ArtCardProps> = ({
  label, description, customUrl, defaultPreview, uploading, isPending, onUpload, onRemove,
}) => (
  <div className={`rounded-lg border overflow-hidden transition-colors ${
    isPending
      ? 'border-theme-accent/50 bg-[var(--theme-popup-bg)]'
      : 'border-theme-border bg-[var(--theme-popup-bg)]'
  }`}>
    {/* Preview area */}
    <div className="relative w-full aspect-square flex items-center justify-center bg-[var(--theme-bg)] overflow-hidden p-3">
      {customUrl ? (
        <img
          src={customUrl}
          alt={label}
          className="max-w-full max-h-full object-contain rounded"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          {defaultPreview}
        </div>
      )}
      {/* Badge */}
      <span className={`absolute top-1.5 right-1.5 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
        isPending
          ? 'text-[var(--theme-accent)] border-[var(--theme-accent)]/30 bg-[var(--theme-accent)]/10'
          : customUrl
            ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10'
            : 'text-theme-dim border-theme-border bg-[var(--theme-popup-bg)]'
      }`}>
        {isPending ? 'Pending' : customUrl ? 'Custom' : 'Default'}
      </span>
    </div>

    {/* Controls */}
    <div className="p-2 border-t border-theme-border">
      <p className="text-[10px] font-bold text-theme-fg mb-0.5">{label}</p>
      <p className="text-[9px] text-theme-dim mb-2">{description}</p>
      <div className="flex gap-1.5">
        <Tooltip content={`Select custom image for ${label}`} placement="bottom">
          <button
            type="button"
            onClick={onUpload}
            disabled={uploading}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-theme-border text-theme-fg hover:text-theme-accent hover:border-theme-accent transition-colors disabled:opacity-40"
          >
            <ImagePlus className="w-3 h-3" />
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </Tooltip>
        {customUrl && (
          <Tooltip content={`Reset ${label} to default artwork`} placement="bottom">
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Reset ${label} to default artwork`}
              className="flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-theme-border text-theme-dim hover:text-red-400 hover:border-red-400/50 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  </div>
)

export default CustomArtSettings
