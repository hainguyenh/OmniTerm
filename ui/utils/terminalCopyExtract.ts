/**
 * Pure text extraction for the pane-header copy menu, plus the request event it rides on.
 *
 * The xterm `Terminal` instance lives inside TerminalView, but the menu button renders in the
 * pane header — an unrelated subtree. Rather than drill props through MainLayout, the menu
 * dispatches `TERMINAL_COPY_EVENT` and the owning TerminalView answers it, the same way
 * `omniterm:focus-terminal` reaches a pane today. Everything here is structural so tests can
 * stand in plain objects for xterm's buffer.
 */

export type TerminalCopyAction = 'last-output' | 'viewport'

/** Event name for copy requests dispatched by the pane-header menu. */
export const TERMINAL_COPY_EVENT = 'omniterm:copy-terminal'

export interface TerminalBufferLineLike {
  /** Mirrors xterm's IBufferLine.translateToString; `true` drops trailing cell padding. */
  translateToString: (trimRight?: boolean) => string
}

export interface TerminalBufferLike {
  active: {
    readonly length: number
    readonly viewportY: number
    getLine: (line: number) => TerminalBufferLineLike | undefined
  }
}

export interface LastOutputTracker {
  /** Feed every `onData` payload; a carriage return marks where the next output begins. */
  noteInput: (data: string) => void
  /** Text printed since the last Enter, prompt line included; '' before any Enter. */
  lastOutputText: () => string
}

/** Join the given lines, dropping trailing blank lines. Returns '' when all are blank. */
const joinTrimmingTrailingBlanks = (lines: string[]): string => {
  let end = lines.length - 1
  while (end >= 0 && lines[end].trim() === '') end -= 1
  return end < 0 ? '' : lines.slice(0, end + 1).join('\n')
}

/**
 * Idle-prompt shapes a shell prints once a command exits — shell chrome, never output. Deliberately
 * narrow so ordinary output that merely contains ">" (tables, arrows, diffs) survives: an
 * interactive PowerShell prompt (`PS F:\repo>`) and a cmd drive-path prompt (`F:\repo>`), each with
 * nothing after the `>`. The echoed command line always has text there, so it can never match.
 */
const isIdlePromptLine = (line: string): boolean =>
  /^PS .+>\s*$/.test(line) || /^[A-Za-z]:\\.*>\s*$/.test(line)

/**
 * Text currently displayed in the viewport — never scrollback. Rows past the end of a shrunk or
 * stale buffer are skipped rather than read; an out-of-range viewport yields ''.
 */
export const viewportText = (buffer: TerminalBufferLike, rows: number): string => {
  const lines: string[] = []
  const first = Math.max(0, buffer.active.viewportY)
  const last = Math.min(buffer.active.length, first + Math.max(0, rows))
  for (let i = first; i < last; i += 1) {
    lines.push(buffer.active.getLine(i)?.translateToString(true) ?? '')
  }
  return joinTrimmingTrailingBlanks(lines)
}

/**
 * Tracks where the user's last Enter landed so "copy last output" can slice the buffer.
 * The marker points at the line the cursor occupied when Enter fired — the echoed prompt +
 * command — so extraction includes it. Full-screen TUI apps rewrite the screen, making this a
 * documented heuristic there (spec: 2026-08-24-terminal-copy-menu-design.md).
 */
export const createLastOutputTracker = (buffer: TerminalBufferLike): LastOutputTracker => {
  let marker = -1
  return {
    noteInput: (data: string) => {
      if (!data.includes('\r')) return
      marker = Math.max(0, buffer.active.length - 1)
    },
    lastOutputText: () => {
      if (marker < 0) return ''
      const first = Math.min(marker, buffer.active.length)
      const lines: string[] = []
      for (let i = first; i < buffer.active.length; i += 1) {
        lines.push(buffer.active.getLine(i)?.translateToString(true) ?? '')
      }
      // The slice starts at the echoed command, so trimming only ever touches the tail: drop the
      // idle prompt the shell printed after the command exited (plus the blank gap ahead of it),
      // but never strip down past the echoed command line itself.
      while (lines.length > 1 && isIdlePromptLine(lines[lines.length - 1] ?? '')) {
        lines.pop()
        while (lines.length > 1 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()
      }
      return joinTrimmingTrailingBlanks(lines)
    },
  }
}

/** Dispatch a copy request for one session. Fired by TerminalCopyMenu. */
export const dispatchTerminalCopy = (sessionId: string, action: TerminalCopyAction): void => {
  window.dispatchEvent(new CustomEvent(TERMINAL_COPY_EVENT, { detail: { sessionId, action } }))
}

/**
 * Validate an inbound copy request at the boundary: the event comes from arbitrary code, so an
 * unexpected shape yields null instead of reaching the clipboard path.
 */
export const parseTerminalCopyEvent = (
  event: Event,
): { sessionId: string; action: TerminalCopyAction } | null => {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail as { sessionId?: unknown; action?: unknown } | undefined
  if (typeof detail?.sessionId !== 'string' || detail.sessionId === '') return null
  if (detail.action !== 'last-output' && detail.action !== 'viewport') return null
  return { sessionId: detail.sessionId, action: detail.action }
}
