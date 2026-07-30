import { Circle, Diamond, Hexagon, Leaf, Triangle, Flame, Cloud, Gem, type LucideIcon } from 'lucide-react'

/**
 * Per-pane identity: a shape and a hue for each slot of the dock grid.
 *
 * With eight panes and a long tab strip, "which pane is this tab in" was carried only by a small grey
 * numeral. Giving each pane a fixed shape + colour lets the pane header, its docked tabs, the pane picker
 * and the footer all be matched by eye. The shape is what actually carries the identity — colour alone
 * fails for colour-blind users and against a themed background.
 *
 * Colours are literal hexes on purpose, following `src/utils/fileKind.ts`: a pane's identity must not
 * shift when the user switches theme. Tailwind cannot compile classes from runtime values, so consumers
 * apply them through inline `style` (`color` / `borderColor` / `backgroundColor`).
 */
export interface PaneIdentity {
  icon: LucideIcon
  color: string
  /** Spoken form for tooltips, e.g. "pane 2 · amber diamond". */
  label: string
}

/** Index = pane index. Length matches MAX_PLANES in MainLayout (the largest layout mode). */
export const PANE_IDENTITY: readonly PaneIdentity[] = [
  { icon: Circle, color: '#7aa2f7', label: 'blue circle' },
  { icon: Diamond, color: '#e0af68', label: 'amber diamond' },
  { icon: Hexagon, color: '#bb9af7', label: 'violet hexagon' },
  { icon: Leaf, color: '#9ece6a', label: 'green leaf' },
  { icon: Triangle, color: '#2ac3de', label: 'cyan triangle' },
  { icon: Flame, color: '#f7768e', label: 'pink flame' },
  { icon: Cloud, color: '#73daca', label: 'teal cloud' },
  { icon: Gem, color: '#ff9e64', label: 'orange gem' },
]

/**
 * Identity of a pane index. Wraps rather than throwing so a stale index from a shrinking layout can
 * never blank out a tab; callers should only ever pass a real pane index (0 … MAX_PLANES-1).
 */
export function paneIdentity(index: number): PaneIdentity {
  const n = PANE_IDENTITY.length
  return PANE_IDENTITY[((Math.trunc(index) % n) + n) % n]
}

/** `hex` at `alpha` (0–1) as an 8-digit hex, for the softer stripe/border of an unfocused pane. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
  return `${hex}${a.toString(16).padStart(2, '0')}`
}
