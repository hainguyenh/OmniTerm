import type { Terminal } from '@xterm/xterm'

/**
 * What each pane in this window currently shows, as text. The inline quota probe
 * (plugins/agent-quota/app/inlineUsageProbe.ts) reads it to tell an agent's prompt from a picker or
 * a dialog, and to parse the panel `/usage` or `/status` draws. Reading the rendered screen instead
 * of the byte stream works for TUIs that paint with cursor moves rather than newlines (codex).
 *
 * A pane in another window (detached) is not registered here, so it reads as unavailable.
 */

type ScreenSource = Pick<Terminal, 'rows'> & { buffer: { active: Pick<Terminal['buffer']['active'], 'baseY' | 'getLine'> } }

const screens = new Map<string, ScreenSource>()

export function registerPaneScreen(sessionId: string, term: ScreenSource): { dispose: () => void } {
  screens.set(sessionId, term)
  return {
    dispose: () => {
      // Identity check: a remounted pane registers a new terminal under the same session id.
      if (screens.get(sessionId) === term) screens.delete(sessionId)
    },
  }
}

/** The recent lines of the pane (including the tail page and recent scrollback), one string per row. */
export function readPaneScreen(sessionId: string): string[] | null {
  const term = screens.get(sessionId)
  if (!term) return null
  const buffer = term.buffer.active
  const bufAny = buffer as unknown as { length?: number; viewportY?: number }
  const hasLength = typeof bufAny.length === 'number'
  const totalLength = hasLength ? (bufAny.length as number) : buffer.baseY + term.rows
  if (totalLength === 0) return []

  const maxLines = Math.min(totalLength, 300)
  let startRow = Math.max(0, totalLength - maxLines)
  if (typeof bufAny.viewportY === 'number') {
    startRow = Math.min(startRow, Math.max(0, bufAny.viewportY))
  }
  if (!hasLength) {
    startRow = buffer.baseY
  }

  const lines: string[] = []
  const endRow = hasLength ? totalLength : buffer.baseY + term.rows
  for (let row = startRow; row < endRow; row += 1) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
  }
  return lines
}
