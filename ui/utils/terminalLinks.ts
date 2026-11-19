import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'

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
 *  Trailing punctuation, angles, and quotes are excluded so a trailing `;` or `]` is not eaten. */
const FILE_PATH_RE =
  /(?<![A-Za-z])[A-Za-z]:[\\/][\w.\\/-]+|~\/[\w.\\/-]+|\.\/[\w.\\/-]+|\.\.\/[\w.\\/-]+|(?<!\w)\/[\w.-]+(?:[\\/][\w.-]+)*|(?<!\w)[\w.-]+(?:[\\/][\w.-]+)+/g
const TRAILING_PATH_PUNCTUATION_RE = /[),.;:!?\]}"'`]+$/
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

/** Map a client cursor position on a line text to whatever link or path sits at `col`, or null. */
export const findLinkOrPathAt = (line: string, col: number): DetectedLinkOrPath | null => {
  if (col < 0 || col >= line.length) return null

  for (const match of line.matchAll(PLAIN_URL_RE)) {
    const raw = match[0].replace(TRAILING_URL_PUNCTUATION_RE, '')
    if (!raw || !safeHttpUrl(raw)) continue
    const start = match.index ?? 0
    const end = start + raw.length
    if (col >= start && col < end) return { kind: 'url', text: raw, start, end }
  }

  for (const match of line.matchAll(FILE_PATH_RE)) {
    const raw = match[0].replace(TRAILING_PATH_PUNCTUATION_RE, '')
    if (!raw) continue
    const start = match.index ?? 0
    const end = start + raw.length
    if (col >= start && col < end) return { kind: 'path', text: raw, start, end, ...pathLocation(line, end) }
  }

  return null
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
  const rect = termEl.getBoundingClientRect()
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
  const buf = term.buffer.active
  const line = buf.getLine(buf.viewportY + row)?.translateToString(true)
  if (!line) return null
  return findLinkOrPathAt(line, col)
}

const plainUrlsOnLine = (text: string, y: number): ILink[] => {
  const links: ILink[] = []
  for (const match of text.matchAll(PLAIN_URL_RE)) {
    const raw = match[0]
    const trimmed = raw.replace(TRAILING_URL_PUNCTUATION_RE, '')
    if (!trimmed) continue
    const start = match.index ?? 0
    const end = start + trimmed.length
    if (!safeHttpUrl(trimmed)) continue
    links.push({
      text: trimmed,
      range: {
        start: { x: start + 1, y },
        end: { x: end + 1, y },
      },
      activate: () => {
        // The modifier-click menu (see `createTerminalContextMenu`) owns link activation now; this
        // no-op keeps xterm's hover-decoration without making it direct-open the URL underneath.
      },
    })
  }
  return links
}

/**
 * Register plain URL linkification so xterm underlines URL spans on the platform link-modifier
 * hover. xterm's `activate` is a no-op — the modifier-click overlay menu owns link activation for
 * both URLs and paths. xterm's built-in provider continues to handle OSC 8 links.
 */
export const registerPlainUrlLinks = (term: Terminal) => {
  const provider: ILinkProvider = {
    provideLinks: (bufferLineNumber, callback) => {
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      callback(line ? plainUrlsOnLine(line.translateToString(true), bufferLineNumber) : undefined)
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
