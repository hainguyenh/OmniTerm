import { matchShortcut } from './keyboard'

/**
 * The one authoritative copy of the app's chrome shortcut defaults.
 *
 * Previously `useAppShortcuts.ts` and `TerminalView.tsx` each hardcoded their own copy of this
 * table. Because TerminalView's key handler lives inside an effect whose deps are
 * `[id, connection, mode]`, its copy closed over the `shortcuts` prop from mount time — so editing a
 * binding in settings silently stopped matching in every already-open pane. A single shared table
 * (read through a ref, not a prop) fixes the staleness and makes the two sides structurally unable
 * to disagree about what counts as a chrome shortcut.
 */
export const FALLBACK_SHORTCUTS: ShortcutBindings = {
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  zoomReset: 'Ctrl+0',
  newSession: 'Ctrl+N',
  newFolder: 'Ctrl+Shift+N',
  openSettings: 'Ctrl+,',
  toggleThemeMode: 'Ctrl+/',
  layout1: 'Ctrl+1',
  layout2: 'Ctrl+2',
  layout3: 'Ctrl+3',
  layout4: 'Ctrl+4',
  layout6: 'Ctrl+6',
  layout8: 'Ctrl+8',
  toggleSidebar: 'Ctrl+B',
  commandPalette: 'CommandOrControl+P',
  closeTab: 'Ctrl+W',
}

/** Layered so a saved-but-stale `shortcuts` object (missing a binding added since) still resolves. */
export const resolveShortcuts = (saved?: Partial<ShortcutBindings>): ShortcutBindings => ({
  ...FALLBACK_SHORTCUTS,
  ...(saved ?? {}),
})

/**
 * Bindings that survive terminal focus even though they aren't Ctrl+Shift+*: the three zoom keys.
 * Zoom over a terminal changes that terminal's own font size (TerminalView owns that separately),
 * so unlike every other binding here it never collides with a shell control key — Ctrl+= and Ctrl+-
 * are not readline/shell defaults, and Ctrl+0 has no shell meaning either.
 */
const TERMINAL_SAFE_KEYS: ReadonlySet<keyof ShortcutBindings> = new Set(['zoomIn', 'zoomOut', 'zoomReset'])

/**
 * A binding with Shift or Alt held is not a shell control-key collision (Ctrl+W, Ctrl+B, Ctrl+N,
 * Ctrl+P, Ctrl+/, Ctrl+, are all bare-Ctrl readline/shell defaults), so those keep working even
 * inside a focused terminal.
 */
const hasShiftOrAlt = (combo: string): boolean => {
  const parts = combo.toLowerCase().split('+').map(p => p.trim())
  return parts.includes('shift') || parts.includes('alt')
}

export const survivesTerminalFocus = (key: keyof ShortcutBindings, combo: string): boolean =>
  TERMINAL_SAFE_KEYS.has(key) || hasShiftOrAlt(combo)

/**
 * Whether `e` matches any chrome shortcut that should fire — and, when `inTerminal` is true, is
 * allowed to override the shell/agent underneath it. Used both by the window-level shortcut handler
 * (to decide whether to preventDefault + act) and by TerminalView's custom key handler (to decide
 * whether to let the key bubble up instead of sending it to the PTY) — the same predicate, so they
 * can't disagree.
 */
export const matchesChromeShortcut = (
  e: KeyboardEvent | React.KeyboardEvent,
  shortcuts: ShortcutBindings,
  opts: { inTerminal: boolean },
): boolean => {
  for (const key of Object.keys(shortcuts) as (keyof ShortcutBindings)[]) {
    const combo = shortcuts[key]
    if (!combo || !matchShortcut(e, combo)) continue
    if (opts.inTerminal && !survivesTerminalFocus(key, combo)) continue
    return true
  }
  return false
}
