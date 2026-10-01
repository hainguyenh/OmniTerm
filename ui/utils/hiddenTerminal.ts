import { Terminal } from '@xterm/xterm'

/**
 * A local terminal no one sees: a real shell session with no pane, whose screen is kept by an
 * xterm that is never attached to the page. The Agent Quota plugin uses one to start a profile's
 * agent in a scratch folder and read `/usage` from it when that profile has no open pane
 * (plugins/agent-quota/app/hiddenProfileProbe.ts).
 *
 * It never joins the window's tabs, so nothing else — session restore, persistence, agent presence,
 * the quota engine — sees it, and it is disconnected and forgotten on `close`.
 */
export interface HiddenTerminal {
  send(data: string): void
  /** The bottom page, one string per row, as a pane scrolled to its tail would show it. */
  screen(): string[]
  onOutput(listener: (text: string) => void): () => void
  close(): Promise<void>
}

const COLS = 120
const ROWS = 40
const READY_TIMEOUT_MS = 10_000

let opened = 0

/** Start a hidden shell in `cwd`; null when the backend refuses the folder or the shell. */
export async function openHiddenTerminal(cwd?: string | null): Promise<HiddenTerminal | null> {
  const api = window.omnitermAPI
  const conn = await api?.shells?.open(undefined, null, null, cwd || null, null).catch(() => null)
  const connId = typeof conn?.id === 'string' ? conn.id : null
  if (!connId) return null
  opened += 1
  const id = `agent-quota-hidden-${Date.now().toString(36)}-${opened}`
  // Never opened into the DOM: the parser still keeps the buffer, and answers the terminal queries
  // an agent sends at start-up (device attributes, cursor position) through onData.
  const term = new Terminal({ cols: COLS, rows: ROWS, scrollback: 500, allowProposedApi: true })
  const decoder = new TextDecoder()
  const listeners = new Set<(text: string) => void>()
  const replies = term.onData((data) => { void api.connect.localInput(id, data) })
  const offData = api.connect.onLocalData(id, (bytes) => {
    term.write(bytes)
    const text = decoder.decode(bytes, { stream: true })
    for (const listener of listeners) listener(text)
  })
  let markReady: () => void = () => {}
  const ready = new Promise<void>((resolve) => { markReady = resolve })
  const offReady = api.connect.onLocalReady(id, () => markReady())
  const offClosed = api.connect.onLocalClosed(id, () => markReady())
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    offData()
    offReady()
    offClosed()
    replies.dispose()
    await Promise.resolve(api.connect.localDisconnect(id))
    api.shells.release(connId)
    term.dispose()
  }
  try {
    await Promise.resolve(api.connect.local(id, connId))
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([ready, new Promise<void>((resolve) => { timer = setTimeout(resolve, READY_TIMEOUT_MS) })])
    clearTimeout(timer)
    void api.connect.localResize(id, { cols: COLS, rows: ROWS })
  } catch {
    await close()
    return null
  }
  return {
    send: (data) => { void api.connect.localInput(id, data) },
    screen: () => {
      const buffer = term.buffer.active
      const lines: string[] = []
      for (let row = 0; row < term.rows; row += 1) {
        lines.push(buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '')
      }
      return lines
    },
    onOutput: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close,
  }
}
