/**
 * Clipboard key routing and paste payload shaping for terminal panes.
 *
 * Both live here rather than inline in TerminalView because the bug they fix is invisible in jsdom
 * (it needs a real WebView to double-fire), so the decision logic has to be unit-testable on its own.
 *
 * ── Why the app has to own Ctrl+V at all ──────────────────────────────────────
 * xterm's `evaluateKeyboardEvent` maps Ctrl+<letter> to a control byte but does NOT set its `cancel`
 * flag, so Ctrl+V both emits `\x16` (^V) to the PTY *and* leaves the keydown un-prevented — which
 * lets Chromium run its native paste, firing xterm's own DOM `paste` listener as a second writer.
 * The PTY therefore receives `^V` plus the text, and the stray `^V` corrupts the `\x1b[200~`
 * bracketed-paste introducer that follows it (readline/Ink treat ^V as quoted-insert, swallowing the
 * ESC). The app's Ctrl+Shift+V handler had the same shape of bug: it returned false without ever
 * calling `preventDefault()`, so it and xterm's native handler each wrote the full clipboard.
 *
 * The fix is to claim these combos explicitly and `preventDefault()`, which suppresses Chromium's
 * synthetic paste event and leaves exactly one writer.
 */

/** Just the fields these decisions need — keeps the helpers callable from tests without a real event. */
export interface ClipboardKeyEvent {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  /** Physical key, so a non-QWERTY layout still resolves V/C correctly. */
  code: string
}

export type ClipboardAction = 'paste' | 'paste-script' | 'copy' | null

/**
 * Which clipboard action, if any, the app should handle for this keydown.
 *
 * `isMac` matters: on macOS Cmd+V produces no key from `evaluateKeyboardEvent`, so xterm never
 * cancels the event and its native `paste` listener is already the sole writer. Intercepting there
 * would only add a way to double-fire, so we deliberately leave it alone.
 *
 * `altVPassthrough`: agents that bind Alt+V to their own clipboard reader need
 * the raw keystroke, not the app's path-insertion. Returning null lets the keydown fall through to
 * xterm, which encodes Alt+V to the PTY as usual.
 */
export const clipboardActionFor = (
  e: ClipboardKeyEvent,
  isMac: boolean,
  altVPassthrough = false,
  isScriptPaste = false,
): ClipboardAction => {
  // Explicit script paste: triggered when matching the paste-script shortcut
  if (isScriptPaste) {
    return 'paste-script'
  }

  // Alt+V is the explicit image-paste binding: agents attach the
  // inserted file path from the prompt. Claimed so the Alt press cannot leak
  // an ESC-prefixed code into the PTY instead.
  if (e.code === 'KeyV' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    return altVPassthrough ? null : 'paste'
  }

  if (e.altKey) return null

  if (e.code === 'KeyV') {
    // Ctrl+V (Windows/Linux) and Ctrl+Shift+V (all platforms, the app's documented binding).
    if (e.ctrlKey && !e.metaKey && (e.shiftKey || !isMac)) return 'paste'
    return null
  }

  if (e.code === 'KeyC') {
    // Only the Shift variant — plain Ctrl+C must stay SIGINT.
    if (e.ctrlKey && e.shiftKey && !e.metaKey) return 'copy'
    return null
  }

  return null
}

/**
 * Shape clipboard text the way a terminal expects.
 *
 * Mirrors xterm's own `prepareTextForTerminal` + `bracketTextForPaste` so that the app path and
 * xterm's native path (still used for right-click and macOS Cmd+V) produce byte-identical writes.
 * Previously the app path sent CRLF verbatim and never bracketed, which is why one paste route ran
 * the pasted lines as commands while the other did not.
 */
export const normalizePastePayload = (text: string, bracketed: boolean): string => {
  const normalized = text.replace(/\r?\n/g, '\r')
  return bracketed ? `\x1b[200~${normalized}\x1b[201~` : normalized
}

/**
 * Shape a multiline PowerShell (.ps1) script for safe interactive execution in pwsh.
 *
 * Wrapping the payload in `. { ... }` ensures that:
 * 1. pwsh / PSReadLine treats the entire multiline script as a single continuation block
 *    without auto-executing intermediate lines upon paste.
 * 2. Any variables, functions, and aliases created by the script stay in the current
 *    session scope (dot-sourcing semantics).
 * 3. Comments on lines (including the last line) cannot comment out the closing brace,
 *    because the closing brace is placed on its own newline.
 * 4. The closing brace has no trailing carriage return/newline, so the prompt halts
 *    at the end of the block, allowing the user to inspect/edit and press Enter to execute.
 */
export const formatPowerShellScriptForPaste = (script: string): string => {
  const trimmed = script.trim()
  if (!trimmed) return ''

  // If already dot-sourced or call-wrapped (. { ... } or & { ... }), keep as-is without double wrapping
  if (/^(\.|&)\s*\{[\s\S]*\}$/.test(trimmed)) {
    return trimmed
  }

  // If already wrapped in a bare script block { ... }, dot-source it: . { ... }
  if (/^\{[\s\S]*\}$/.test(trimmed)) {
    return `. ${trimmed}`
  }

  return `. {\n${trimmed}\n}`
}
