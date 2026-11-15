import type { PresetId } from './layoutPresets'

/**
 * The pane grid of each preset as CSS grid template areas (one string per row, `p<N>` per pane),
 * drawn as small filled cells by the layout picker (`.layout-glyph` UI specification).
 */
export const GLYPH_AREAS: Readonly<Record<PresetId, readonly string[]>> = {
  '1': ['p0'],
  '2': ['p0 p1'],
  '2h': ['p0', 'p1'],
  '1+2': ['p0 p1', 'p0 p2'],
  '2x2': ['p0 p1', 'p2 p3'],
  '3x2': ['p0 p1 p2', 'p3 p4 p5'],
  '4x2': ['p0 p1 p2 p3', 'p4 p5 p6 p7'],
}

export interface GlyphGrid {
  gridTemplateAreas: string
  gridTemplateColumns: string
  gridTemplateRows: string
  cells: string[]
}

/** The grid style and the cell areas that draw `preset`. */
export function glyphGrid(preset: PresetId): GlyphGrid {
  const rows = GLYPH_AREAS[preset]
  const columns = rows[0]!.split(' ').length
  const cells = [...new Set(rows.flatMap((row) => row.split(' ')))]
  return {
    gridTemplateAreas: rows.map((row) => `'${row}'`).join(' '),
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))`,
    cells,
  }
}
