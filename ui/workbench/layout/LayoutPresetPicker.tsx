import { useRef, useState } from 'react'

import { Popup } from '../../ide/ui/Popup'
import { Tooltip } from '../../components/Tooltip'

import { glyphGrid } from './layoutGlyphs'
import { PRESETS, presetDef, type DetectedPreset, type PresetId } from './layoutPresets'

/** A preset drawn as a grid of small filled cells (the mock's `.layout-glyph`). */
function Glyph({ preset, width, height }: { preset: PresetId; width: number; height: number }) {
  const { cells, ...grid } = glyphGrid(preset)
  return (
    <span className="grid gap-[2px] flex-none" style={{ ...grid, width, height }} data-layout-glyph={preset} aria-hidden="true">
      {cells.map((area) => (
        <i key={area} className="rounded-[2px] bg-[var(--fg-subtle)] opacity-75" style={{ gridArea: area }} />
      ))}
    </span>
  )
}

interface LayoutPresetPickerProps {
  current: DetectedPreset
  onSelect: (preset: PresetId) => void
}

/**
 * The pane layout control at the bottom of the right stripe: one button that shows the current
 * layout and opens the presets (1, 2 columns, 1 + 2, 2 × 2, 3 × 2, 4 × 2, 2 rows) as a grid of
 * glyphs beside it. Choosing fewer panes merges the extra panes' tabs, nothing is closed.
 */
export function LayoutPresetPicker({ current, onSelect }: LayoutPresetPickerProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const label = current === 'custom' ? 'Custom layout' : presetDef(current).label
  return (
    <div data-testid="layout-preset-picker" data-layout-preset={current} className="flex flex-col items-center flex-shrink-0">
      <Tooltip content={`Pane layout: ${label}`} placement="left">
        <button
          ref={anchor}
          type="button"
          aria-label={`Pane layout: ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={`inline-flex items-center justify-center w-[30px] h-[30px] rounded-md transition-colors hover:bg-[var(--bg-toolbar-hover)] ${
            open ? 'bg-[var(--bg-stripe-selected)]' : ''
          }`}
        >
          <Glyph preset={current === 'custom' ? '2x2' : current} width={20} height={14} />
        </button>
      </Tooltip>
      <Popup
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        placement="left-end"
        offset={8}
        role="menu"
        aria-label="Pane layout"
        className="w-[330px] p-2"
      >
        <div className="px-0.5 pt-1.5 pb-0.5 text-[11.5px] text-[var(--fg-muted)]">Pane layout</div>
        <div className="grid grid-cols-4 gap-1">
          {PRESETS.map((preset) => {
            const on = current === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                aria-keyshortcuts={preset.shortcut?.replace('Ctrl', 'Control')}
                onClick={() => {
                  setOpen(false)
                  onSelect(preset.id)
                }}
                className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded-md text-[11px] ${
                  on ? 'bg-[var(--bg-selected)] text-[var(--fg)]' : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <Glyph preset={preset.id} width={42} height={28} />
                {preset.label}
              </button>
            )
          })}
        </div>
      </Popup>
    </div>
  )
}
