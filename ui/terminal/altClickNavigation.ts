/**
 * iTerm2-style Alt+Click cursor positioning for terminals that have no mouse reporting.
 *
 * When a TUI or shell has NOT enabled SGR mouse mode, a plain click can only start a native
 * selection — the cursor never moves. With Alt held we translate the clicked cell into the
 * equivalent arrow-key burst and write it to the PTY, so programs with a line editor (and full
 * screen editors via their own key bindings) move the cursor as if the arrows were pressed.
 */

export interface CellPos {
  col: number
  row: number
}

/** Upper bound per axis: a far click must not flood the PTY with hundreds of arrow bytes. */
const MAX_BURST_PER_AXIS = 40

export function buildArrowBurst(from: CellPos, to: CellPos, applicationCursorKeys: boolean): string {
  const prefix = applicationCursorKeys ? '\x1bO' : '\x1b['
  const right = prefix + 'C'
  const left = prefix + 'D'
  const down = prefix + 'B'
  const up = prefix + 'A'

  const clamp = (delta: number): number => Math.max(-MAX_BURST_PER_AXIS, Math.min(MAX_BURST_PER_AXIS, delta))
  const colDelta = clamp(to.col - from.col)
  const rowDelta = clamp(to.row - from.row)

  // Horizontal first, then vertical — the order real arrow mashing would produce.
  return (
    (colDelta > 0 ? right.repeat(colDelta) : left.repeat(-colDelta)) +
    (rowDelta > 0 ? down.repeat(rowDelta) : up.repeat(-rowDelta))
  )
}

/**
 * Whether this mousedown should become an arrow burst. Plain clicks keep native selection
 * behavior; any active mouse-tracking mode means the program owns the mouse and gets the event.
 */
export function altClickArrows(
  event: { altKey: boolean; shiftKey: boolean },
  mouseTrackingMode?: string,
): boolean {
  if (!event.altKey || event.shiftKey) return false
  return mouseTrackingMode === undefined || mouseTrackingMode === 'none' || mouseTrackingMode === ''
}

/** Translate pointer coordinates into terminal cells, clamped to the visible grid. */
export function cellFromPointer(clientX: number, clientY: number, rect: DOMRect, cols: number, rows: number): CellPos {
  const cellWidth = rect.width / cols
  const cellHeight = rect.height / rows
  const col = Math.max(0, Math.min(cols - 1, Math.floor((clientX - rect.left) / cellWidth)))
  const row = Math.max(0, Math.min(rows - 1, Math.floor((clientY - rect.top) / cellHeight)))
  return { col, row }
}
