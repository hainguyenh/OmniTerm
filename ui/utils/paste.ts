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

/** The divider printed when a pasted script runs, separating the script's echo from its output. */
export const SCRIPT_OUTPUT_BANNER = '========== Output =========='

/** Lines in a pasted script, as the user wrote them (what the header comment counts). */
export const countScriptLines = (script: string): number => {
  const trimmed = script.trim()
  return trimmed ? trimmed.split(/\r\n|\r|\n/).length : 0
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
 *
 * Everything OmniTerm adds is on its own short line and marked as such: the `# >>>` header and the
 * `# <<<` footer bracket the user's lines, and the `Write-Host` divider (tagged `# OmniTerm`) only
 * prints once the block runs, so the output starts under a clear `Output` divider on a fresh line.
 * Every added line stays well under 80 columns: PSReadLine redraws a multi-line block on each edit,
 * and a line that wraps in a narrow pane is where that redraw overlaps itself. The markers are plain
 * ASCII so they read the same in Windows PowerShell 5.1 under a legacy code page.
 */
export const formatPowerShellScriptForPaste = (script: string): string => {
  const trimmed = script.trim()
  if (!trimmed) return ''

  const lines = countScriptLines(trimmed)
  const banner = `Write-Host "\`n${SCRIPT_OUTPUT_BANNER}" -ForegroundColor Cyan`

  // Already dot-sourced or call-wrapped (. { ... } or & { ... }): keep the user's own block.
  if (/^(\.|&)\s*\{[\s\S]*\}$/.test(trimmed)) {
    return `${banner}; ${trimmed}`
  }

  // Already a bare script block { ... }: dot-source it rather than nesting a second block.
  const body = /^\{[\s\S]*\}$/.test(trimmed) ? trimmed.slice(1, -1).replace(/^\s*\n|\n\s*$/g, '') : trimmed
  const open = `. { # >>> OmniTerm: pasted script, ${lines} line${lines === 1 ? '' : 's'} - Enter runs, Ctrl+C discards`
  return `${open}\n${banner} # OmniTerm\n${body}\n} # <<< end of pasted script`
}

export interface ScriptPasteTarget {
  platform: string
  connectionType?: string
  shell?: string
  /** The agent latched on this pane, if any — its TUI is not a PowerShell prompt. */
  agentName?: string | null
}

/**
 * Whether Ctrl+Alt+V may wrap the clipboard as a PowerShell block here. Only a local Windows pane
 * whose shell is PowerShell (the Windows default) qualifies, and only while no agent TUI owns it —
 * anywhere else the wrapper would be sent to cmd, bash, an SSH host or Claude as literal text, so
 * the shortcut falls back to an ordinary paste.
 */
export const canPasteAsPowerShellScript = ({ platform, connectionType, shell, agentName }: ScriptPasteTarget): boolean =>
  platform === 'win32'
  && connectionType === 'LOCAL'
  && (shell === undefined || shell === 'powershell' || shell === 'default')
  && !agentName
