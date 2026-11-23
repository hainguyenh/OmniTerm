import type { IBufferLine, Terminal } from '@xterm/xterm'

/** Where one UTF-16 unit of a logical line is drawn: 0-based buffer row and column. */
export interface CellPosition {
  row: number
  col: number
  /** Drawn two cells wide: the cell to its right shows it too. */
  wide?: boolean
}

/**
 * A buffer row joined with the rows soft-wrapped onto it, as one string, plus the cell each code
 * unit of that string is drawn in. Link detection runs on the string; the positions translate a
 * clicked cell into a string index and a match back into a cell range.
 *
 * Reading cells instead of assuming "string index = column" keeps the two in step when a row holds
 * a wide character (CJK, most emoji: one unit, two cells) or a surrogate pair (two units, one or two
 * cells) — an agent's `● ` bullets and emoji status lines shifted every path after them otherwise.
 */
export interface LogicalLine {
  text: string
  cells: readonly CellPosition[]
}

/** A long line of output is joined only this far; a path never spans more rows than this. */
const MAX_JOINED_ROWS = 20

function appendRow(line: IBufferLine, row: number, parts: string[], cells: CellPosition[]): void {
  if (typeof line.getCell !== 'function') {
    const text = line.translateToString(true)
    for (let col = 0; col < text.length; col++) cells.push({ row, col })
    parts.push(text)
    return
  }
  for (let col = 0; col < line.length; col++) {
    const cell = line.getCell(col)
    // Width 0 is the right half of a wide character, already read with its left half.
    if (!cell || cell.getWidth() === 0) continue
    const chars = cell.getChars() || ' '
    const wide = cell.getWidth() > 1
    for (let unit = 0; unit < chars.length; unit++) cells.push(wide ? { row, col, wide } : { row, col })
    parts.push(chars)
  }
}

/** The logical line `row` (0-based buffer row) belongs to, or null when the row does not exist. */
export function logicalLineAt(term: Terminal, row: number): LogicalLine | null {
  const buffer = term.buffer.active
  if (!buffer.getLine(row)) return null
  let first = row
  while (first > 0 && row - first < MAX_JOINED_ROWS && buffer.getLine(first)?.isWrapped) first--
  let last = row
  while (last - first < MAX_JOINED_ROWS && buffer.getLine(last + 1)?.isWrapped) last++
  const parts: string[] = []
  const cells: CellPosition[] = []
  for (let current = first; current <= last; current++) {
    const line = buffer.getLine(current)
    if (!line) break
    appendRow(line, current, parts, cells)
  }
  const text = parts.join('').replace(/\s+$/, '')
  return { text, cells: cells.slice(0, text.length) }
}

/** The index in `line.text` of the character drawn at `row`/`col`, or -1 past the end of it. */
export function indexOfCell(line: LogicalLine, row: number, col: number): number {
  const exact = line.cells.findIndex((cell) => cell.row === row && cell.col === col)
  if (exact >= 0) return exact
  // The right half of a wide character belongs to the character on its left.
  return line.cells.findIndex((cell) => cell.row === row && cell.col === col - 1 && cell.wide === true)
}
