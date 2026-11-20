import { create } from 'zustand'

import { PANE_ZOOM_MAX, PANE_ZOOM_MIN, PANE_ZOOM_STEP, clampPaneZoom } from '../../utils/paneZoom'

import { PRESETS, presetForPaneCount, type DetectedPreset, type PresetId } from './layoutPresets'

/**
 * Terminal zoom per layout preset. Grids of four panes and more start zoomed out in proportion to
 * the size a pane gets from the window; the user can step it, return to 1:1 or go back to "auto".
 * It scales terminal fonts only: file editors keep the editor's own font zoom.
 */

/**
 * A pane this size shows a terminal at 100%: a classic 80 x 24 terminal at the default font. Smaller
 * panes shrink the font in proportion.
 */
export const REFERENCE_PANE = { width: 640, height: 384 } as const
/** The automatic zoom stops here so text stays readable; the user can still step lower by hand. */
export const AUTO_ZOOM_MIN = 0.7
/** The zoom control and the automatic zoom start from this many panes. */
export const ZOOM_FROM_PANE_COUNT = 4

const GRID: Record<PresetId, { cols: number; rows: number }> = {
  '1': { cols: 1, rows: 1 },
  '2': { cols: 2, rows: 1 },
  '2h': { cols: 1, rows: 2 },
  '1+2': { cols: 2, rows: 2 },
  '2x2': { cols: 2, rows: 2 },
  '3x2': { cols: 3, rows: 2 },
  '4x2': { cols: 4, rows: 2 },
}

export interface AreaSize {
  width: number
  height: number
}

/** The preset zoom is kept under: a custom layout counts as the preset that holds its panes. */
export function zoomKey(preset: DetectedPreset, paneCount: number): PresetId {
  return preset === 'custom' ? presetForPaneCount(paneCount) : preset
}

export function hasZoom(key: PresetId): boolean {
  return PRESETS.find((preset) => preset.id === key)!.panes >= ZOOM_FROM_PANE_COUNT
}

/** 100% for small layouts; otherwise the pane's share of the window against the reference pane. */
export function autoZoom(key: PresetId, area: AreaSize | null): number {
  if (!hasZoom(key)) return 1
  const { cols, rows } = GRID[key]
  if (!area || area.width <= 0 || area.height <= 0) return clampPaneZoom(Math.max(AUTO_ZOOM_MIN, 1 - 0.15 * (cols - 1)))
  const fit = Math.min(area.width / cols / REFERENCE_PANE.width, area.height / rows / REFERENCE_PANE.height)
  return clampPaneZoom(Math.max(AUTO_ZOOM_MIN, fit))
}

interface SessionZoomState {
  overrides: Partial<Record<PresetId, number>>
}

const STORAGE_KEY = 'omniterm.sessionZoom.v1'

/** Persisted zoom is untrusted: only known presets with a number inside the zoom range survive. */
export function parseStoredZoom(raw: unknown): Partial<Record<PresetId, number>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Partial<Record<PresetId, number>> = {}
  for (const preset of PRESETS) {
    const value = (raw as Record<string, unknown>)[preset.id]
    if (typeof value === 'number' && Number.isFinite(value) && value >= PANE_ZOOM_MIN && value <= PANE_ZOOM_MAX) {
      out[preset.id] = clampPaneZoom(value)
    }
  }
  return out
}

function load(): Partial<Record<PresetId, number>> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    return raw ? parseStoredZoom(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

export const useSessionZoom = create<SessionZoomState>(() => ({ overrides: load() }))

/** A number sets the zoom of that preset, null returns it to automatic. */
export function setZoomOverride(key: PresetId, zoom: number | null): void {
  const next = { ...useSessionZoom.getState().overrides }
  if (zoom === null) delete next[key]
  else next[key] = clampPaneZoom(zoom)
  useSessionZoom.setState({ overrides: next })
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage may be blocked: the zoom then lasts for this run only.
  }
}

/** The zoom in force: the user's choice for the preset, else the automatic one. */
export function effectiveZoom(key: PresetId, area: AreaSize | null, overrides: SessionZoomState['overrides']): number {
  return overrides[key] ?? autoZoom(key, area)
}

/** One step up or down from `current`, kept inside the zoom range. */
export function stepZoom(current: number, direction: 1 | -1): number {
  return clampPaneZoom(current + direction * PANE_ZOOM_STEP)
}
