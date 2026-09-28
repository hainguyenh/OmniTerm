/**
 * Visual markup for a Ctrl+Alt+V script paste: a thin accent bar down the left edge of every row
 * the pasted block echoed onto, drawn as an xterm decoration so nothing is ever written to the PTY
 * or into the terminal's text.
 *
 * The bar only lives while the block waits to be run. Enter (run), Ctrl+C or Esc (discard) remove
 * it: once the script runs, its output — or a `Clear-Host` — reuses those rows, and a bar left
 * behind would sit on top of text that is no longer the script. It never covers the text itself:
 * no background, no hint over the line — the block's own header comment says how to run it.
 *
 * The rows are only known once the shell has echoed the paste back, so the bar is measured after
 * the output settles (the echo arrives as a burst of writes), with a cap so a silent shell still
 * gets its markup.
 */
import type { IDisposable, Terminal } from '@xterm/xterm'

import './pastedScript.css'

const SETTLE_MS = 120
const MAX_WAIT_MS = 1_500
const MAX_ROWS = 1_000

export interface PastedScriptMarkup {
  dispose: () => void
}

/** Input that runs or discards the pending block: Enter, Ctrl+C, or a lone Esc (not an arrow key). */
const endsPendingBlock = (data: string): boolean => data.includes('\r') || data.includes('\x03') || data === '\x1b'

/** Mark the paste that is about to be written at the cursor. Returns null without decoration support. */
export function markPastedScript(term: Terminal): PastedScriptMarkup | null {
  if (typeof term.registerMarker !== 'function' || typeof term.registerDecoration !== 'function') return null
  const start = term.registerMarker(0)
  if (!start) return null

  const disposables: IDisposable[] = [start]
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let writeSub: IDisposable | undefined
  let finished = false
  // The paste itself reaches onData (with its own CRs) synchronously; only later input is the user's.
  let armed = false

  const stopWatching = () => {
    clearTimeout(settleTimer)
    clearTimeout(maxWait)
    writeSub?.dispose()
    writeSub = undefined
  }

  const dispose = () => {
    finished = true
    stopWatching()
    for (const disposable of disposables) disposable.dispose()
    disposables.length = 0
  }

  const draw = () => {
    stopWatching()
    if (finished || start.isDisposed) return
    const buffer = term.buffer.active
    const end = buffer.baseY + buffer.cursorY
    const height = Math.min(MAX_ROWS, Math.max(1, end - start.line + 1))
    const gutter = term.registerDecoration({ marker: start, x: 0, width: 1, height, layer: 'top' })
    if (!gutter) return
    disposables.push(gutter)
    gutter.onRender(element => element.classList.add('pasted-script-gutter'))
  }

  if (typeof term.onWriteParsed === 'function') {
    writeSub = term.onWriteParsed(() => {
      clearTimeout(settleTimer)
      settleTimer = setTimeout(draw, SETTLE_MS)
    })
  }
  const maxWait = setTimeout(draw, MAX_WAIT_MS)

  const input = term.onData(data => {
    if (armed && endsPendingBlock(data)) dispose()
  })
  disposables.push(input)
  queueMicrotask(() => { armed = true })

  return { dispose }
}
