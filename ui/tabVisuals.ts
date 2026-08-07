import type { SessionStatus } from '@omniterm/contract'

// ── Session status display maps ───────────────────────────────────────────────
// Shared by the tab strip, the mini pane headers, the pane picker and the footer so a
// session reads the same everywhere.

export const STATUS_DOT: Record<SessionStatus, string> = {
  connecting: 'bg-theme-warning',
  connected: 'bg-theme-accent',
  closed: 'bg-[#565f89]',
  error: 'bg-theme-error',
}

export const STATUS_TEXT: Record<SessionStatus, string> = {
  connecting: 'text-theme-warning',
  connected: 'text-theme-success',
  closed: 'text-theme-dim',
  error: 'text-theme-error',
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  closed: 'Disconnected',
  error: 'Error',
}

/**
 * Where a tab's session currently sits relative to the window's pane grid. This is the axis the
 * tab's *shape* (stripe / border / fill) encodes; its live status is the separate dot + icon axis,
 * so "which of my many tabs is on screen" and "which are still alive" can be read independently.
 *
 * - `focused`    — docked in the pane that has focus (exactly one tab at a time)
 * - `docked`     — docked in another visible pane of the current layout
 * - `background` — running, but not shown in any visible pane
 */
export type TabPlacement = 'focused' | 'docked' | 'background'

export function tabPlacement(paneIdx: number, focusedPane: number): TabPlacement {
  if (paneIdx === -1) return 'background'
  return paneIdx === focusedPane ? 'focused' : 'docked'
}

/** Fill + border + text colour per placement. Deliberately no `opacity-*` here — see `tabClasses`. */
const PLACEMENT_CLS: Record<TabPlacement, string> = {
  focused: 'bg-theme-bg border-theme-accent text-theme-accent',
  docked: 'bg-theme-bg border-theme-border text-theme-fg',
  background: 'bg-transparent border-transparent text-theme-dim hover:text-theme-fg hover:border-theme-border',
}

/** The left edge bar: solid for the focused pane, faint for other docked panes, absent otherwise. */
export const PLACEMENT_STRIPE: Record<TabPlacement, string | null> = {
  focused: 'bg-theme-accent',
  docked: 'bg-theme-accent/40',
  background: null,
}

const PLACEMENT_LABEL: Record<TabPlacement, string> = {
  focused: 'in view — active pane',
  docked: 'in view',
  background: 'running in background',
}

export interface TabFlags {
  /** Ad-hoc / launcher-spawned session — not saved in the tree, gone when closed. */
  ephemeral?: boolean
  /** Opened for a quick look only; the next preview open reuses this slot. */
  preview?: boolean
  /** Null for editor tabs, which own no backend session. */
  status?: SessionStatus | null
  /**
   * Whether the shell is running something. `undefined` = not knowable for this session (SSH, RDP,
   * or the Electron backend), which reads as neither busy nor pointedly idle.
   */
  busy?: boolean
}

/**
 * The activity axis, for a connected local shell: is it working, or waiting at its prompt?
 *
 * An idle shell's dot is a hollow ring rather than a filled disc — "nothing happening here" has to be
 * visible at a glance in a strip of twenty tabs, and dimming alone already means "not docked".
 */
export function activityDot(flags: TabFlags = {}): string {
  const status = flags.status ?? 'connecting'
  if (flags.busy === undefined || status !== 'connected') return `${STATUS_DOT[status]} border-transparent`
  return flags.busy
    ? `${STATUS_DOT.connected} border-transparent`
    : 'bg-transparent border-theme-dim'
}

/** How a session's activity reads in the tooltip. */
export function activityLabel(flags: TabFlags = {}): string | null {
  if (flags.busy === undefined || (flags.status ?? 'connecting') !== 'connected') return null
  return flags.busy ? 'running' : 'idle'
}

/** Class list for a tab pill. `dead` sessions dim as a whole; placement never sets opacity itself. */
export function tabClasses(placement: TabPlacement, flags: TabFlags = {}): string {
  const dead = flags.status === 'closed' || flags.status === 'error'
  return [
    PLACEMENT_CLS[placement],
    flags.ephemeral ? 'border-dashed' : '',
    dead ? 'opacity-60' : '',
  ].filter(Boolean).join(' ')
}

/**
 * Hover text spelling out every state the colours encode, so the scheme is discoverable.
 *
 * `paneLabel` names the pane's shape/hue (see paneIdentity.ts) for a docked tab, so the tooltip says
 * *which* pane rather than just "in view".
 */
export function tabTitle(
  name: string,
  placement: TabPlacement,
  paneIdx: number,
  layoutMode: number,
  flags: TabFlags = {},
  paneLabel?: string,
): string {
  const parts: string[] = []
  if (flags.status) {
    const activity = activityLabel(flags)
    parts.push(activity ? `${STATUS_LABEL[flags.status]} · ${activity}` : STATUS_LABEL[flags.status])
  }
  const place = placement !== 'background' && layoutMode > 1
    ? `${PLACEMENT_LABEL[placement]} (pane ${paneIdx + 1}${paneLabel ? ` · ${paneLabel}` : ''})`
    : PLACEMENT_LABEL[placement]
  parts.push(place)
  if (flags.ephemeral) parts.push('temporary session')
  if (flags.preview) parts.push('preview — double-click to keep open')
  return `${name} — ${parts.join(' · ')}`
}
