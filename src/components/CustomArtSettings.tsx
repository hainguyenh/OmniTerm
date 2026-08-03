import React, { useRef, useState } from 'react'
import { ChevronRight, ImagePlus, RotateCcw } from 'lucide-react'
import { DefaultIdleArt, DefaultLoadingArt } from '../assets/defaultArt'

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
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const handleUpload = async (slot: ArtSlot) => {
    setUploading(slot)
    try {
      await window.omnitermAPI.customArt.upload(slot)
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
      onArtChanged()
    } catch {
      // Ignore
    }
  }

  return (
    <div className="px-4 py-2.5 border-t border-theme-border">
      {/* Clickable header row — toggles expand/collapse */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 group cursor-pointer bg-transparent border-none p-0 text-left"
      >
        <ChevronRight
          className="w-3 h-3 text-theme-dim transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
        />
        <span className="text-[10px] uppercase font-bold tracking-widest text-theme-dim">Pane Art</span>
      </button>

      {/* Collapsible body — animated max-height */}
      <div
        ref={contentRef}
        className="overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out"
        style={{
          maxHeight: expanded ? contentRef.current?.scrollHeight ?? 600 : 0,
          opacity: expanded ? 1 : 0,
        }}
      >
        <p className="text-[11px] text-theme-dim mt-2 mb-3">
          Upload custom images or GIFs for idle and loading panes in Light and Dark modes. (max 2 MB).
        </p>

        <div className="grid grid-cols-2 gap-3">
          <ArtCard
            label="Idle (Light)"
            description="Empty panes in Light theme"
            customUrl={idleArtUrlLight}
            defaultPreview={<DefaultIdleArt dark={false} />}
            uploading={uploading === 'idle-light'}
            onUpload={() => handleUpload('idle-light')}
            onRemove={() => handleRemove('idle-light')}
          />

          <ArtCard
            label="Idle (Dark)"
            description="Empty panes in Dark theme"
            customUrl={idleArtUrlDark}
            defaultPreview={<DefaultIdleArt dark={true} />}
            uploading={uploading === 'idle-dark'}
            onUpload={() => handleUpload('idle-dark')}
            onRemove={() => handleRemove('idle-dark')}
          />

          <ArtCard
            label="Loading (Light)"
            description="Connecting in Light theme"
            customUrl={loadingArtUrlLight}
            defaultPreview={<DefaultLoadingArt dark={false} />}
            uploading={uploading === 'loading-light'}
            onUpload={() => handleUpload('loading-light')}
            onRemove={() => handleRemove('loading-light')}
          />

          <ArtCard
            label="Loading (Dark)"
            description="Connecting in Dark theme"
            customUrl={loadingArtUrlDark}
            defaultPreview={<DefaultLoadingArt dark={true} />}
            uploading={uploading === 'loading-dark'}
            onUpload={() => handleUpload('loading-dark')}
            onRemove={() => handleRemove('loading-dark')}
          />
        </div>
      </div>
    </div>
  )
}

interface ArtCardProps {
  label: string
  description: string
  customUrl: string | null
  defaultPreview: React.ReactNode
  uploading: boolean
  onUpload: () => void
  onRemove: () => void
}

const ArtCard: React.FC<ArtCardProps> = ({
  label, description, customUrl, defaultPreview, uploading, onUpload, onRemove,
}) => (
  <div className="rounded-lg border border-theme-border bg-[var(--theme-popup-bg)] overflow-hidden">
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
        customUrl
          ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10'
          : 'text-theme-dim border-theme-border bg-[var(--theme-popup-bg)]'
      }`}>
        {customUrl ? 'Custom' : 'Default'}
      </span>
    </div>

    {/* Controls */}
    <div className="p-2 border-t border-theme-border">
      <p className="text-[10px] font-bold text-theme-fg mb-0.5">{label}</p>
      <p className="text-[9px] text-theme-dim mb-2">{description}</p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onUpload}
          disabled={uploading}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-theme-border text-theme-fg hover:text-theme-accent hover:border-theme-accent transition-colors disabled:opacity-40"
        >
          <ImagePlus className="w-3 h-3" />
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        {customUrl && (
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-theme-border text-theme-dim hover:text-red-400 hover:border-red-400/50 transition-colors"
            title="Reset to default"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  </div>
)

export default CustomArtSettings
