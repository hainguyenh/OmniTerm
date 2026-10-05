/**
 * Feature profile for one open document — the editor's take on VS Code's "large file optimizations"
 * and `maxTokenizationLineLength`.
 *
 * CodeMirror only renders the viewport, so a big file is cheap to *show*; what is not cheap is
 * everything that walks the whole document or a whole line: incremental parsing for highlighting,
 * fold ranges, bracket matching and selection-match scanning. Past these thresholds those features
 * switch off and the file opens as plain text, which stays responsive at the 25 MiB open ceiling.
 */

export type FileProfile = 'full' | 'large' | 'longLines'

/** Bytes (≈ characters) above which the document is treated as large. */
export const LARGE_FILE_CHARS = 2 * 1024 * 1024
export const LARGE_FILE_LINES = 50_000
/** A line longer than this (minified bundles, one-line JSON) disables highlighting. */
export const LONG_LINE_CHARS = 10_000

export interface DocumentShape {
  chars: number
  lines: number
  maxLineLen: number
}

export function profileFor({ chars, lines, maxLineLen }: DocumentShape): FileProfile {
  if (chars > LARGE_FILE_CHARS || lines > LARGE_FILE_LINES) return 'large'
  if (maxLineLen > LONG_LINE_CHARS) return 'longLines'
  return 'full'
}

/** User-facing reason a profile switched features off, or null for the full profile. */
export function profileNotice(profile: FileProfile): string | null {
  if (profile === 'large') return 'Large file: syntax highlighting, folding and bracket matching are off to keep editing fast.'
  if (profile === 'longLines') return 'Very long lines: syntax highlighting is off to keep editing fast.'
  return null
}

/** How long to wait after the last edit before re-rendering a preview of `chars` characters. */
export function debounceFor(chars: number): number {
  if (chars <= 256 * 1024) return 300
  if (chars <= 1024 * 1024) return 800
  return 1500
}
