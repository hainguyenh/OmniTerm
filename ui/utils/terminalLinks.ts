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

/** Open a validated link only from the platform's normal terminal-link modifier click. */
export const activateTerminalLink = (event: MouseEvent, text: string): void => {
  if (isMac() ? !event.metaKey : !event.ctrlKey) return
  const url = safeHttpUrl(text)
  if (!url) return
  window.open(url.href, '_blank', 'noopener,noreferrer')
}

// ── Right-click link/path detector ────────────────────────────────────────
//
// Detects HTTP(S) URLs *and* local file paths beneath a right-click so the pane can show a small
// overlay menu ("Copy Link/Path", "Open Link/Path"). URLs are matched first — see
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

/** The link/path classification a right-click is offering a small overlay menu for. */
export type TerminalLinkMenuKind = 'url' | 'path'

export interface DetectedLinkOrPath {
  kind: TerminalLinkMenuKind
  text: string
  /** 0-based start col within the line. */
  start: number
  /** 0-based end col (exclusive). */
  end: number
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
    if (col >= start && col < end) return { kind: 'path', text: raw, start, end }
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
      activate: activateTerminalLink,
    })
  }
  return links
}

/** Register plain URL linkification; xterm's built-in provider continues to handle OSC 8 links. */
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
