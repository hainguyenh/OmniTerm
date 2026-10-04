import { Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { handleCsvRequest, MAX_ROWS, readRow, type CsvScan } from './csvParse'
import { createCsvWorker } from './editorWorkers'
import { PreviewMessage } from './PreviewMessage'
import { useScrollViewport } from './useScrollViewport'
import { useWorkerTask } from './useWorkerTask'
import { colRange, prefixSums, rowRange } from './virtualWindow'

const ROW_HEIGHT = 24
const CELL_CHARS = 500
const ROW_CACHE = 2000
const DEFAULT_COLUMN_WIDTH = 120

interface CsvPreviewProps {
  text: string
  fileName: string
}

/** Fields of each parsed row, least recently used first, bounded so scrolling a huge file does not
 *  accumulate every row it ever showed. */
class RowCache {
  private rows = new Map<number, string[]>()

  constructor(private readonly text: string, private readonly scan: CsvScan) {}

  get(row: number): string[] {
    const cached = this.rows.get(row)
    if (cached) {
      this.rows.delete(row)
      this.rows.set(row, cached)
      return cached
    }
    const fields = readRow(this.text, this.scan, row)
    this.rows.set(row, fields)
    if (this.rows.size > ROW_CACHE) {
      const oldest = this.rows.keys().next()
      if (!oldest.done) this.rows.delete(oldest.value)
    }
    return fields
  }
}

const clip = (value: string) => (value.length > CELL_CHARS ? `${value.slice(0, CELL_CHARS)}…` : value)

/**
 * A spreadsheet-style grid over CSV/TSV. Rows are indexed in a worker; the grid renders only the
 * rows and columns intersecting the viewport, each parsed on demand.
 */
export function CsvPreview({ text, fileName }: CsvPreviewProps) {
  const payload = useMemo(() => ({ text, fileName }), [text, fileName])
  const { state, retry } = useWorkerTask(createCsvWorker, handleCsvRequest, payload, { size: text.length })
  const [header, setHeader] = useState(true)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const viewport = useScrollViewport(scroller)

  const scan = state.result
  const source = state.input?.text ?? ''
  const cache = useMemo(() => (scan ? new RowCache(source, scan) : null), [scan, source])
  const widths = useMemo(() => {
    if (!scan) return []
    return Array.from({ length: Math.max(1, scan.maxColumns) }, (_, column) => scan.columnWidths[column] ?? DEFAULT_COLUMN_WIDTH)
  }, [scan])
  const prefix = useMemo(() => prefixSums(widths), [widths])

  if (!scan || !cache) {
    return state.status === 'error'
      ? <PreviewMessage text={state.error ?? 'Preview failed.'} onAction={retry} />
      : <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 animate-spin" aria-label="Loading" /></div>
  }

  const headerRows = header && scan.rowCount > 0 ? 1 : 0
  const dataRows = scan.rowCount - headerRows
  const gutter = String(Math.max(dataRows, 1)).length * 8 + 16
  const totalWidth = gutter + prefix[prefix.length - 1]
  const [rowStart, rowEnd] = rowRange(viewport.scrollTop, viewport.height - ROW_HEIGHT * headerRows, ROW_HEIGHT, dataRows)
  const [colStart, colEnd] = colRange(prefix, Math.max(0, viewport.scrollLeft - gutter), viewport.width)

  const cells = (row: number) => {
    const fields = cache.get(row)
    const out = []
    for (let column = colStart; column < colEnd; column += 1) {
      const value = clip(fields[column] ?? '')
      out.push(
        <div key={column} className="csv-cell" title={value.length > 40 ? value : undefined}
          style={{ left: gutter + prefix[column], width: widths[column] }}>
          {value}
        </div>,
      )
    }
    return out
  }

  const rows = []
  for (let index = rowStart; index < rowEnd; index += 1) {
    rows.push(
      <div key={index} className="csv-row" style={{ top: ROW_HEIGHT * (headerRows + index), width: totalWidth }}>
        <div className="csv-cell csv-gutter" style={{ width: gutter }}>{index + 1}</div>
        {cells(index + headerRows)}
      </div>,
    )
  }

  return (
    <div className="csv-preview">
      <div className="csv-toolbar">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={header} onChange={(event) => setHeader(event.target.checked)} />
          First row is header
        </label>
        <span className="ml-auto">
          {dataRows.toLocaleString()} rows × {scan.maxColumns} columns
          {state.status === 'running' && ' · updating…'}
        </span>
      </div>
      {scan.truncated && <div className="csv-notice">Showing the first {MAX_ROWS.toLocaleString()} rows.</div>}
      {scan.literalFrom < scan.rowCount && (
        <div className="csv-notice">A quoted field on row {scan.literalFrom + 1} is never closed; quotes from there on are shown as-is.</div>
      )}
      <div ref={setScroller} className="csv-scroll">
        <div className="csv-canvas" style={{ height: ROW_HEIGHT * (headerRows + dataRows), width: totalWidth }}>
          {headerRows > 0 && (
            <div className="csv-row csv-header" style={{ width: totalWidth }}>
              <div className="csv-cell csv-gutter" style={{ width: gutter }} />
              {cells(0)}
            </div>
          )}
          {rows}
        </div>
      </div>
    </div>
  )
}

