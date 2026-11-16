/**
 * Where the workbench shows Agent quota (Settings › Plugins › Agent quota › Display), as in
 * UI prototype: a live status line on the left or right tab strip, a left or right
 * tool window, the footer status line, the right tool window plus the footer, or nowhere.
 */
export type QuotaDock = 'stripL' | 'stripR' | 'left' | 'right' | 'footer' | 'both' | 'hidden'

export const QUOTA_DOCKS: ReadonlyArray<{ id: QuotaDock; label: string }> = [
  { id: 'stripL', label: 'Left tab strip — live status line' },
  { id: 'stripR', label: 'Right tab strip — live status line' },
  { id: 'left', label: 'Left tool window' },
  { id: 'right', label: 'Right tool window' },
  { id: 'footer', label: 'Footer status line (aligned with the editor)' },
  { id: 'both', label: 'Right tool window + footer' },
  { id: 'hidden', label: 'Hidden' },
]

const DOCK_IDS = new Set<string>(QUOTA_DOCKS.map((dock) => dock.id))

export function isQuotaDock(value: unknown): value is QuotaDock {
  return typeof value === 'string' && DOCK_IDS.has(value)
}

/**
 * A stored dock, or for settings written before it existed the closest match of the old `footer`
 * flag: footer chips stay in the footer, everything else gets the default right tool window.
 */
export function parseQuotaDock(value: unknown, legacyFooter: unknown): QuotaDock {
  if (isQuotaDock(value)) return value
  return legacyFooter === true ? 'footer' : 'right'
}

/** The tool window side for a dock, if the dock is a tool window. */
export function dockToolWindowSide(dock: QuotaDock): 'left' | 'right' | null {
  if (dock === 'left') return 'left'
  if (dock === 'right' || dock === 'both') return 'right'
  return null
}

export const dockShowsFooter = (dock: QuotaDock): boolean => dock === 'footer' || dock === 'both'

/** The tab strip that carries the live status line, if any. */
export function dockStripSide(dock: QuotaDock): 'left' | 'right' | null {
  if (dock === 'stripL') return 'left'
  if (dock === 'stripR') return 'right'
  return null
}
