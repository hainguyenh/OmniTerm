import { Circle, Diamond, Hexagon, Leaf, Triangle, Flame, Cloud, Gem, type LucideIcon } from 'lucide-react'

/**
 * The session identity palette: a shape and a hue per session (see workbench/sessions/sessionColors.ts,
 * which hands them out). The shape carries the identity: colour alone fails for colour-blind users and
 * against a themed background.
 *
 * Colours are literal hexes on purpose, following `ui/utils/fileKind.ts`: a session's identity must not
 * shift when the user switches theme. Tailwind cannot compile classes from runtime values, so consumers
 * apply them through inline `style`.
 */
export interface PaneIdentity {
  icon: LucideIcon
  color: string
  /** Spoken form for tooltips, e.g. "pane 2 · amber diamond". */
  label: string
}

/** Eight entries: as many as the largest layout has panes. */
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
