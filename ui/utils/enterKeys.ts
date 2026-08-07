/**
 * Modifier+Enter sequences for terminal panes.
 *
 * xterm 5.5 has no kitty-keyboard-protocol or modifyOtherKeys support, and its own Enter rule is
 * `key = altKey ? ESC+CR : CR` — so Shift+Enter, Ctrl+Enter and Ctrl+Shift+Enter all collapse to a
 * bare `\r`, indistinguishable from a plain Enter. AI agent TUIs (Claude Code, Copilot CLI, Codex)
 * rely on Shift+Enter to insert a newline instead of submitting, and their `/terminal-setup` helpers
 * cannot configure OmniTerm, so the app has to inject the sequence itself.
 *
 * `\x1b\r` (ESC + CR) is the default because it is what those helpers configure for iTerm2 and
 * VS Code, making it the sequence agents already recognise. `\n` is offered for the ones that want a
 * literal line feed.
 */

export type EnterMode = 'esc-cr' | 'lf' | 'off'

export const ESC_CR = '\x1b\r'
export const LF = '\n'

export interface EnterKeyEvent {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  code: string
}

export interface EnterModes {
  shiftEnter: EnterMode
  ctrlEnter: EnterMode
}

export const DEFAULT_ENTER_MODES: EnterModes = { shiftEnter: 'esc-cr', ctrlEnter: 'lf' }

const MODES: readonly EnterMode[] = ['esc-cr', 'lf', 'off']

const isMode = (v: unknown): v is EnterMode => MODES.includes(v as EnterMode)

/**
 * Read the two settings, falling back per-field. Persisted settings are shallow-merged over the
 * backend defaults, so a settings file written before these keys existed resolves them as absent —
 * and a hand-edited value that is not one of the three modes must not silently disable the key.
 */
export const resolveEnterModes = (s: { shiftEnter?: string; ctrlEnter?: string }): EnterModes => ({
  shiftEnter: isMode(s.shiftEnter) ? s.shiftEnter : DEFAULT_ENTER_MODES.shiftEnter,
  ctrlEnter: isMode(s.ctrlEnter) ? s.ctrlEnter : DEFAULT_ENTER_MODES.ctrlEnter,
})

const sequenceFor = (mode: EnterMode): string | null =>
  mode === 'esc-cr' ? ESC_CR : mode === 'lf' ? LF : null

/**
 * The bytes to send for a modifier+Enter keydown, or `null` to let xterm handle the key itself.
 *
 * Deliberately falls through in two cases:
 *  - **Alt+Enter** — xterm already emits `\x1b\r`, so claiming it would only risk drifting from that.
 *  - **Ctrl+Alt+Enter** — xterm's `_isThirdLevelShift` treats ctrl+alt as AltGr on Windows and bails
 *    without sending anything. That is a real keyboard-layout concern, not a bug to paper over here.
 */
export const enterSequenceFor = (e: EnterKeyEvent, modes: EnterModes): string | null => {
  if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return null
  if (e.metaKey || e.altKey) return null

  // Shift wins when both are held: it is the combo users actually press for a newline, and the
  // ctrl+shift variant is far more likely to be a fumbled Shift+Enter than a deliberate Ctrl+Enter.
  if (e.shiftKey) return sequenceFor(modes.shiftEnter)
  if (e.ctrlKey) return sequenceFor(modes.ctrlEnter)
  return null
}
