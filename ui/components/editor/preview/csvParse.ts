import { extensionOf } from '../editorFileKinds'
import type { HandlerResult } from './workerProtocol'

/**
 * CSV/TSV indexing for the grid preview.
 *
 * The scan only records where each row starts — one `Uint32Array`, handed back from the worker
 * without a copy — instead of building every row's fields. The grid then parses just the rows on
 * screen. A 25 MB file is one pass to index and a few dozen `parseRow` calls per frame to show.
 */

export const MAX_ROWS = 500_000
const SAMPLE_ROWS = 1000
const QUOTE = 34
const LF = 10
const CR = 13

export interface CsvScan {
  delimiter: string
  /** Offset of each row's first character, plus one final entry: the end of the last row. */
  rowStarts: Uint32Array
  rowCount: number
  /** The file has more rows than `MAX_ROWS`; only the first ones are indexed. */
  truncated: boolean
  /** Rows from this index on are read with quotes taken literally: a quote opened there never
   *  closed, and honouring it would have swallowed the rest of the file into one cell. */
  literalFrom: number
  columnWidths: number[]
  maxColumns: number
}

const CANDIDATES = [',', ';', '\t', '|']

/** Pick the delimiter that splits the first lines most consistently. `.tsv` is always tab. */
export function sniffDelimiter(text: string, fileName: string): string {
  if (extensionOf(fileName) === 'tsv') return '\t'
  const lines = text.slice(0, 64 * 1024).split(/\r?\n/).filter((line) => line.length > 0).slice(0, 10)
  let best = ','
  let bestScore = 0
  for (const candidate of CANDIDATES) {
    const counts = lines.map((line) => line.split(candidate).length - 1)
    const min = Math.min(...counts)
    if (!lines.length || min === 0) continue
    const consistent = counts.every((count) => count === counts[0])
    const score = min * (consistent ? 2 : 1)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/** Index rows starting at `from`. Returns the starts found and, if a quoted field ran to the end of
 *  the text, the index (into `starts`) of the row it opened in. */
function indexRows(text: string, delimiter: number, from: number, quotes: boolean, starts: number[], maxRows: number) {
  let inQuotes = false
  let fieldStart = true
  let quoteRow = -1
  for (let i = from; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    if (inQuotes) {
      if (c === QUOTE) {
        if (text.charCodeAt(i + 1) === QUOTE) i += 1
        else inQuotes = false
      }
      continue
    }
    if (quotes && c === QUOTE && fieldStart) {
      inQuotes = true
      quoteRow = starts.length - 1
      fieldStart = false
    } else if (c === delimiter) {
      fieldStart = true
    } else if (c === LF || c === CR) {
      if (c === CR && text.charCodeAt(i + 1) === LF) i += 1
      if (starts.length > maxRows) return { open: -1, stoppedAt: i + 1 }
      starts.push(i + 1)
      fieldStart = true
    } else {
      fieldStart = false
    }
  }
  return { open: inQuotes ? quoteRow : -1, stoppedAt: text.length }
}

export function scanRows(text: string, delimiter: string, maxRows = MAX_ROWS): CsvScan {
  const code = delimiter.charCodeAt(0)
  const starts = [0]
  const first = indexRows(text, code, 0, true, starts, maxRows)
  const literalFrom = first.open >= 0 ? first.open : Number.POSITIVE_INFINITY
  let stoppedAt = first.stoppedAt
  if (first.open >= 0) {
    starts.length = first.open + 1
    stoppedAt = indexRows(text, code, starts[first.open], false, starts, maxRows).stoppedAt
  }
  // Indexing stopped early only at the row cap. Otherwise the final entry must be the text's end: a
  // trailing newline already put it there, and without one the last row still needs its end.
  const truncated = stoppedAt < text.length
  if (!truncated && starts[starts.length - 1] !== text.length) starts.push(text.length)
  const rowCount = Math.max(0, starts.length - 1)
  const scan: CsvScan = {
    delimiter, rowStarts: Uint32Array.from(starts), rowCount, truncated,
    literalFrom: Number.isFinite(literalFrom) ? literalFrom : rowCount, columnWidths: [], maxColumns: 0,
  }
  const widths: number[] = []
  for (let row = 0; row < Math.min(rowCount, SAMPLE_ROWS); row += 1) {
    readRow(text, scan, row).forEach((field, column) => {
      widths[column] = Math.max(widths[column] ?? 0, Math.min(field.length, 60))
    })
  }
  scan.columnWidths = widths.map((chars) => Math.min(320, Math.max(48, chars * 7 + 16)))
  scan.maxColumns = widths.length
  return scan
}

/** Split one row into fields, honouring RFC 4180 quoting unless `quotes` is false. */
export function parseRow(text: string, start: number, end: number, delimiter: string, quotes = true): string[] {
  let stop = end
  while (stop > start && (text.charCodeAt(stop - 1) === LF || text.charCodeAt(stop - 1) === CR)) stop -= 1
  const fields: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStart = true
  for (let i = start; i < stop; i += 1) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (quotes && ch === '"' && fieldStart) {
      inQuotes = true
      fieldStart = false
    } else if (ch === delimiter) {
      fields.push(field)
      field = ''
      fieldStart = true
    } else {
      field += ch
      fieldStart = false
    }
  }
  fields.push(field)
  return fields
}

/** The fields of row `row` of a scan. */
export function readRow(text: string, scan: CsvScan, row: number): string[] {
  return parseRow(text, scan.rowStarts[row], scan.rowStarts[row + 1], scan.delimiter, row < scan.literalFrom)
}

/** Worker entry: validate the request and index the text. */
export function handleCsvRequest(payload: unknown): HandlerResult<CsvScan> {
  if (typeof payload !== 'object' || payload === null || !('text' in payload) || !('fileName' in payload)
    || typeof payload.text !== 'string' || typeof payload.fileName !== 'string') {
    throw new Error('Malformed CSV request')
  }
  const scan = scanRows(payload.text, sniffDelimiter(payload.text, payload.fileName))
  return { result: scan, transfer: [scan.rowStarts.buffer] }
}
