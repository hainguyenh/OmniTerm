import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'

import { adjacentLogicalLine, indexOfCell, logicalLineAt, type LogicalLine } from './terminalLogicalLine'

const PLAIN_URL_RE = /\bhttps?:\/\/[^\s<>'"`]+/gi
const TRAILING_URL_PUNCTUATION_RE = /[),.;:!?\]}]+$/

/**
 * Keep terminal links deliberately narrow. Output is untrusted: only HTTP(S) URLs without
 * credentials or control/whitespace characters may leave the application.
 */
export const safeHttpUrl = (value: string): URL | null => {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || !url.hostname) return null
    return url
  } catch {
    return null
  }
}

const isMac = (): boolean => /Mac/i.test(navigator.platform || navigator.userAgent)

/**
 * True when the platform's normal terminal-link modifier is held — Cmd on macOS, Ctrl elsewhere.
 * Single source of truth shared by the renderer-side triggers that surface the link/path menu so the
 * menu and xterm's hover-decoration stay in step on the same platform.
 */
export const isTerminalLinkModifierClick = (event: MouseEvent): boolean =>
  isMac() ? event.metaKey : event.ctrlKey

// ── link/path detector ─────────────────────────────────────────────────────
//
// Detects HTTP(S) URLs *and* local file paths beneath a platform link-modifier click so the pane
// can show a small overlay menu ("Copy Link/Path", "Open Link/Path"). URLs are matched first — see
// `findLinkOrPathAt` — so `https://example/x.txt` is never mis-read as a path even though its
// `/x.txt` tail would otherwise match the path regex.

/** A filesystem path that may be opened with the OS's default handler. Anchored with one of:
 *  - a Windows drive prefix `X:\` or `X:/` (look-behind rejects a preceding letter so the
 *    `le:/` slice of `file:///…` cannot slip through)
 *  - a home anchor `~/`
 *  - a relative anchor `./` or `../`
 *  - a POSIX absolute `/`
 *  - a bare multi-segment relative `a/b/c.ext` (requires at least one separator; `name.txt` alone
 *    is intentionally NOT matched — `country.iso` in shell output is a word, not a path).
 *  Trailing punctuation, angles, and quotes are excluded so a trailing `;` or `]` is not eaten.
 *  A name may hold square brackets after its first character (`56070-[Handoff]-review.md`); a
 *  closing bracket the name did not open is punctuation (`[see src/a.ts]`, `[a](src/a.ts)`).
 *  A folder between two separators may hold single spaces (`runs/Sprint 254/a.html`,
 *  `C:\My Documents\a.txt`) when each word after a space starts with a digit or a capital: prose
 *  between two paths (`src/a.ts and src/b.ts`) stays two paths. The first and last segment never
 *  take a space, so `see src/a.ts` does not swallow `see`. */
const NAME_CHAR = String.raw`[\w.\[\]-]`
const NAME = String.raw`[\w.-]${NAME_CHAR}*`
const SPACED_DIR = String.raw`(?:${NAME}(?: [A-Z0-9]${NAME_CHAR}*)*[\\/])*`
const FILE_PATH_RE = new RegExp(
  [
    String.raw`(?<![A-Za-z])[A-Za-z]:[\\/]${SPACED_DIR}[\w.\\/\[\]-]+`,
    String.raw`(?:~|\.|\.\.)\/${SPACED_DIR}[\w.\\/\[\]-]+`,
    String.raw`(?<!\w)\/${SPACED_DIR}${NAME}(?:[\\/]${NAME_CHAR}+)*`,
    String.raw`(?<!\w)${NAME}[\\/]${SPACED_DIR}${NAME_CHAR}+(?:[\\/]${NAME_CHAR}+)*`,
  ].join('|'),
  'g',
)
const TRAILING_PATH_PUNCTUATION_RE = /[,.;:!?"'`]$/
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
const count = (text: string, char: string) => text.split(char).length - 1

/** `raw` without the punctuation that ends a sentence, or a bracket it closes but never opened. */
const trimPathEnd = (raw: string): string => {
  let text = raw
  for (;;) {
    const last = text.at(-1)
    if (!last) return text
    const opener = CLOSERS[last]
    if (opener ? count(text, opener) >= count(text, last) : !TRAILING_PATH_PUNCTUATION_RE.test(last)) return text
    text = text.slice(0, -1)
  }
}
/** A location printed right after a path: `:12`, `:12:5`, `(12)` or `(12,5)` (1-based). */
const PATH_LOCATION_RE = /^(?::(\d+)(?::(\d+))?|\((\d+)(?:[,:](\d+))?\))/

/** The link/path classification a modifier click is offering a small overlay menu for. */
export type TerminalLinkMenuKind = 'url' | 'path'

export interface DetectedLinkOrPath {
  kind: TerminalLinkMenuKind
  text: string
  /** 0-based start col within the line. */
  start: number
  /** 0-based end col (exclusive). */
  end: number
  /** 1-based line printed after a path (`a.ts:12`); the path text itself never includes it. */
  line?: number
  /** 1-based column printed after the line (`a.ts:12:5`). */
  col?: number
  /**
   * Longer readings to try before `text`, most likely first: the path joined with the word that
   * ends the line before it or starts the line after it. An agent that wraps its own reply breaks
   * `runs/Sprint 254/a.html` into `runs/Sprint` and `254/a.html`; only the opener, which checks the
   * disk, can tell a split path from a path followed by prose.
   */
  candidates?: string[]
}

/** The `:line[:col]` that follows a path at `end`, when there is one. */
const pathLocation = (line: string, end: number): Pick<DetectedLinkOrPath, 'line' | 'col'> => {
  const match = PATH_LOCATION_RE.exec(line.slice(end))
  if (!match) return {}
  const row = Number(match[1] ?? match[3])
  const col = Number(match[2] ?? match[4])
  if (!(row > 0)) return {}
  return col > 0 ? { line: row, col } : { line: row }
}

/**
 * Every URL and path on `line`, URLs first. A path inside a URL (`https://h/x.txt` has a `/x.txt`
 * tail) is no path of its own.
 */
export const linkSpansOnLine = (line: string): DetectedLinkOrPath[] => {
  const spans: DetectedLinkOrPath[] = []
  for (const match of line.matchAll(PLAIN_URL_RE)) {
    const raw = match[0].replace(TRAILING_URL_PUNCTUATION_RE, '')
    if (!raw || !safeHttpUrl(raw)) continue
    const start = match.index ?? 0
    spans.push({ kind: 'url', text: raw, start, end: start + raw.length })
  }
  const urls = [...spans]
  for (const match of line.matchAll(FILE_PATH_RE)) {
    const raw = trimPathEnd(match[0])
    if (!raw) continue
    const start = match.index ?? 0
    const end = start + raw.length
    if (urls.some((url) => start < url.end && end > url.start)) continue
    spans.push({ kind: 'path', text: raw, start, end, ...pathLocation(line, end) })
  }
  return spans
}

/** Map a client cursor position on a line text to whatever link or path sits at `col`, or null. */
export const findLinkOrPathAt = (line: string, col: number): DetectedLinkOrPath | null => {
  if (col < 0 || col >= line.length) return null
  return linkSpansOnLine(line).find((span) => col >= span.start && col < span.end) ?? null
}

const LEADING_WORD_RE = /^\s*([^\s<>"'`]+)/
const TRAILING_WORD_RE = /([^\s<>"'`]+)$/

/**
 * The readings of `span` (on `line`) joined across a hard line break: the word that ends the line
 * before it when the span opens its line, the word that starts the line after it when the span
 * closes its line — joined with a space (the break replaced one) and without (it fell mid-word).
 */
export const joinedPathCandidates = (
  span: DetectedLinkOrPath,
  line: string,
  before: string | null,
  after: string | null,
): string[] => {
  const opensLine = !line.slice(0, span.start).trim()
  const closesLine = !line.slice(span.end).replace(PATH_LOCATION_RE, '').trim()
  const prev = opensLine && before ? TRAILING_WORD_RE.exec(before.trimEnd())?.[1] : undefined
  const next = closesLine && after ? trimPathEnd(LEADING_WORD_RE.exec(after)?.[1] ?? '') || undefined : undefined
  const heads = prev ? [`${prev} `, prev, ''] : ['']
  const tails = next ? [` ${next}`, next, ''] : ['']
  const candidates = heads.flatMap((head) => tails.map((tail) => `${head}${span.text}${tail}`))
  return candidates.filter((candidate) => candidate !== span.text)
}

const FILE_NAME_RE = /\.[A-Za-z0-9]{1,10}$/
const JOINER_END_RE = /[-_.\\/]$/

/**
 * The word that opens `line` when it finishes a path the line before broke off: an agent wrapping
 * its reply prints `spdd/reviews/56070-` and `Handoff-review.md` on two lines, and the second half
 * has no separator, so on its own it is no path. Only a word right after a path that closes its
 * line, and that looks like the rest of one (a file name, or the path ended mid-name on `-`, `_`,
 * `.` or a separator), is taken; the opener checks the joined readings against the disk.
 */
export const continuationSpan = (line: string, before: string | null): DetectedLinkOrPath | null => {
  if (!before) return null
  const head = /^(\s*)([^\s<>"'`]+)/.exec(line)
  const text = trimPathEnd(head?.[2] ?? '')
  if (!head || !text) return null
  const start = head[1]!.length
  const end = start + text.length
  if (linkSpansOnLine(line).some((span) => start < span.end && end > span.start)) return null
  const prev = linkSpansOnLine(before).filter((span) => span.kind === 'path').at(-1)
  if (!prev || before.slice(prev.end).trim()) return null
  const midName = JOINER_END_RE.test(prev.text)
  if (!midName && !FILE_NAME_RE.test(text)) return null
  const joined = `${prev.text}${text}`
  const spaced = `${prev.text} ${text}`
  return { kind: 'path', text, start, end, ...pathLocation(line, end), candidates: midName ? [joined, spaced] : [spaced, joined] }
}

/** The links of `line`, with the continuation of a path broken off on the line before. */
const spansWithContinuation = (term: Terminal, line: LogicalLine): DetectedLinkOrPath[] => {
  const spans = linkSpansOnLine(line.text)
  const continuation = continuationSpan(line.text, adjacentLogicalLine(term, line, -1)?.text ?? null)
  return continuation ? [...spans, continuation] : spans
}

/** `found` on `line` with the readings joined across the lines around it, when there are any. */
const withJoinedCandidates = (term: Terminal, line: LogicalLine, found: DetectedLinkOrPath): DetectedLinkOrPath => {
  if (found.kind !== 'path') return found
  const before = adjacentLogicalLine(term, line, -1)?.text ?? null
  const after = adjacentLogicalLine(term, line, 1)?.text ?? null
  const candidates = joinedPathCandidates(found, line.text, before, after)
  return candidates.length ? { ...found, candidates } : found
}

/**
 * Same, but starting from a mouse event inside the terminal pane. Maps the cursor's pixel position
 * to a buffer (col, row) using xterm's affine layout (cellWidth = clientWidth / cols), then probes
 * that line. Returns null if the click lands outside the grid or on a line that has nothing
 * link-like at that column.
 */
export const findLinkOrPathInTerminal = (
  term: Terminal,
  termEl: HTMLElement,
  clientX: number,
  clientY: number,
): DetectedLinkOrPath | null => {
  // The grid is xterm's screen element: the pane around it is wider by the scrollbar and the part
  // of a cell that did not fit, which skewed every column computed from the pane's own width.
  const screen = termEl.querySelector<HTMLElement>('.xterm-screen')
  const rect = (screen ?? termEl).getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const left = clientX - rect.left
  const top = clientY - rect.top
  if (left < 0 || top < 0 || left >= rect.width || top >= rect.height) return null

  const cols = term.cols
  const rows = term.rows
  if (cols <= 0 || rows <= 0) return null

  const cellWidth = rect.width / cols
  const cellHeight = rect.height / rows
  const col = Math.floor(left / cellWidth)
  const row = Math.floor(top / cellHeight)
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null

  // xterm's `viewportY` is the buffer line at the top of the visible viewport (0-indexed). Adding
  // the in-viewport row gets the same index the link provider receives (minus its +1 sentinel).
  const bufferRow = term.buffer.active.viewportY + row
  const line = logicalLineAt(term, bufferRow)
  if (!line) return null
  const index = indexOfCell(line, bufferRow, col)
  if (index < 0) return null
  const found = findLinkOrPathAt(line.text, index)
  if (found) return withJoinedCandidates(term, line, found)
  const continuation = continuationSpan(line.text, adjacentLogicalLine(term, line, -1)?.text ?? null)
  return continuation && index >= continuation.start && index < continuation.end ? continuation : null
}

/** The links of the logical line holding buffer row `y - 1` that touch that row (xterm asks per row). */
const plainLinksOnRow = (term: Terminal, y: number): ILink[] => {
  const line = logicalLineAt(term, y - 1)
  if (!line) return []
  const links: ILink[] = []
  for (const span of spansWithContinuation(term, line)) {
    const first = line.cells[span.start]
    const last = line.cells[span.end - 1]
    if (!first || !last || first.row > y - 1 || last.row < y - 1) continue
    links.push({
      text: span.text,
      // 1-based and inclusive; a span wrapped onto the next rows keeps one range across them.
      range: {
        start: { x: first.col + 1, y: first.row + 1 },
        end: { x: last.col + (last.wide ? 2 : 1), y: last.row + 1 },
      },
      decorations: { underline: true, pointerCursor: true },
      activate: () => {
        // The modifier click (see `createTerminalContextMenu`) owns activation: a plain click on
        // an agent's output must not open a file or a page. This keeps only the hover cue.
      },
    })
  }
  return links
}

/**
 * Underline URLs and file paths on hover, so it shows that a modifier click opens them. xterm's
 * `activate` is a no-op — the modifier-click handler opens a path in the editor (a local pane) or
 * shows the URL/path menu. xterm's built-in provider continues to handle OSC 8 links.
 */
export const registerPlainTextLinks = (term: Terminal) => {
  const provider: ILinkProvider = {
    provideLinks: (bufferLineNumber, callback) => {
      const links = plainLinksOnRow(term, bufferLineNumber)
      callback(links.length ? links : undefined)
    },
  }
  if (typeof term.registerLinkProvider !== 'function') return { dispose: () => {} }
  return term.registerLinkProvider(provider)
}

/**
 * What an OSC 8 hyperlink points at, in the shape a plain-text detection has: an HTTP(S) URL, or a
 * local file from a `file://` URI (`file:///D:/w/a.ts`, `file://localhost/home/a.ts:12:5`). Agent
 * TUIs print these with a label (`a.ts`) that names no path the plain-text detector could find.
 * Any other scheme, a remote host, or a malformed URI is no link.
 */
export const oscLinkTarget = (uri: string): Omit<DetectedLinkOrPath, 'start' | 'end'> | null => {
  const url = safeHttpUrl(uri)
  if (url) return { kind: 'url', text: url.href }
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return null
  }
  if (parsed.protocol !== 'file:' || (parsed.host !== '' && parsed.host !== 'localhost')) return null
  let path: string
  try {
    path = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  // `/D:/w/a.ts` is the Windows path `D:/w/a.ts`.
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
  if (!path || /[\u0000-\u001f\u007f]/.test(path)) return null
  const located = /^(.*?)(?::(\d+)(?::(\d+))?)$/.exec(path)
  const row = Number(located?.[2])
  if (!located || !(row > 0)) return { kind: 'path', text: path }
  const col = Number(located[3])
  return { kind: 'path', text: located[1], line: row, ...(col > 0 ? { col } : {}) }
}
