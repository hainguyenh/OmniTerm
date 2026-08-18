import type { Terminal } from '@xterm/xterm'
import type { SessionChannel } from './sessionChannel'
import { chunkForWrite } from './writeChunks'
import { OutputHighlighter } from '../highlighter'
import { MAX_SCROLLBACK_BYTES, loadScrollback, saveScrollback } from './scrollbackStore'
import type { SessionStatus } from '../components/MainLayout'

/**
 * Everything that flows between a running session and one xterm instance: status, output, exit, and
 * the two one-sided side channels (SSH metrics, local busy/idle).
 *
 * Split out of TerminalView so the byte path is readable on its own — it is where the app's rendering
 * bugs concentrate (a single oversized `write()` blocks a frame; colouring output the wrong way
 * corrupts a TUI's own frames), and none of it depends on React.
 */

export interface TerminalStreamOptions {
  term: Terminal
  api: SessionChannel
  /** This pane's session key. Also identifies it to the metrics/activity subscriptions. */
  id: string
  isLocal: boolean
  /** Shown in the SSH connect banner. */
  host?: string
  /** 'attach' binds to an already-running session and replays its buffer; 'connect' starts one. */
  mode: 'connect' | 'attach'
  onStatus: (status: SessionStatus) => void
  onExit: (code: number) => void
  onMetrics: (m: SessionMetrics) => void
  onActivity: (busy: boolean) => void
  /** Whether client-side smart colouring is on, read at write time so the toggle affects live panes. */
  smartColors: () => boolean
  /** Re-fit after output that can change the pane's state (the connect banner, an attach replay). */
  refit: () => void
  /** True while this stream's terminal is still the mounted one — guards the async attach result. */
  isCurrent: () => boolean
  /**
   * IndexedDB key preserving this pane's output across app restarts. Local sessions only —
   * remote sessions are never restored, so there is no load-back path. Maps 1:1 to the
   * persisted tab's `scrollbackKey` in the session snapshot.
   */
  scrollbackKey?: string
}

/** Feed `text` to xterm in pieces it can parse without blocking a frame. */
const writeChunked = (term: Terminal, text: string) => {
  for (const chunk of chunkForWrite(text)) term.write(chunk)
}

export interface TerminalStream {
  /** Drop every subscription made by this stream. */
  dispose: () => void
  /**
   * The app just sent the session something it will echo back (a paste). Suspends smart colouring
   * over the echo — see `OutputHighlighter.noteLocalEcho`.
   */
  noteLocalEcho: () => void
}

/** Subscribe to a session and start (or attach to) it. */
export const attachTerminalStream = ({
  term, api, id, isLocal, host, mode,
  onStatus, onExit, onMetrics, onActivity, smartColors, refit, isCurrent, scrollbackKey,
}: TerminalStreamOptions): TerminalStream => {
  // LOCAL only: ConPTY spawns the child (e.g. wsl.exe) almost instantly, but the shell behind it can
  // take much longer to actually produce a prompt — a cold WSL VM boot in particular can take several
  // seconds of total silence. Keep the 'connecting' status (and its loading overlay) up until the
  // first real output arrives, instead of flipping to 'connected' on the handshake and leaving the
  // pane looking blank the whole time. SSH's shell channel reliably sends a prompt/MOTD immediately,
  // so it keeps the old ready-is-connected behavior.
  let sawFirstData = !isLocal

  const cleanupReady = api.onReady(() => {
    if (!isLocal) {
      onStatus('connected')
      term.write('\r\n\x1b[32mConnected to ' + host + '\x1b[0m\r\n')
    }
    refit()
  })

  // Stream pipeline: bytes → UTF-8 text (a streaming decoder handles chunk-split multibyte chars) →
  // optional smart colouring → terminal. The highlighter always sees the text so its
  // escape-sequence state stays in sync even while the toggle is off.
  const decoder = new TextDecoder('utf-8')
  const highlighter = new OutputHighlighter()

  /**
   * True from just before `resume()` until it settles. The backend pushes a session's whole buffered
   * scrollback — up to 256 KiB — down this same data channel inside `attach_session`, before the call
   * returns (see tauriSessions.ts), so the message that arrives in that window is the replay rather
   * than live output. Cleared unconditionally when resume settles, so a session with an empty buffer
   * (no replay message at all) cannot leave the flag set for live data.
   */
  let expectingReplay = false
  let streamBusy = false

  const setStreamActive = (busy: boolean) => {
    if (streamBusy !== busy) {
      streamBusy = busy
      onActivity(busy)
    }
  }

  // ── Cross-restart scrollback ────────────────────────────────────────────────
  // Raw output (pre-colouring) is accumulated under `scrollbackKey` and flushed to IndexedDB on
  // a debounce, so a restart can repaint what this pane had on screen. On a fresh connect the
  // saved text is loaded FIRST: until that read settles, incoming text is parked in `gated` so
  // restored history always lands above live output.
  let scrollBuffer = ''
  let scrollDirty = false
  let scrollTimer: ReturnType<typeof setTimeout> | null = null
  let gated: string[] | null = scrollbackKey && mode === 'connect' ? [] : null
  let gatedReplay: boolean[] = []
  const SCROLLBACK_SAVE_MS = 3_000

  const appendScrollback = (text: string) => {
    if (!scrollbackKey) return
    scrollBuffer += text
    if (scrollBuffer.length > MAX_SCROLLBACK_BYTES) {
      scrollBuffer = scrollBuffer.slice(-MAX_SCROLLBACK_BYTES)
    }
    scrollDirty = true
  }

  const scheduleScrollbackSave = () => {
    if (!scrollbackKey || scrollTimer) return
    scrollTimer = setTimeout(() => {
      scrollTimer = null
      if (scrollDirty) {
        scrollDirty = false
        void saveScrollback(scrollbackKey, scrollBuffer)
      }
    }, SCROLLBACK_SAVE_MS)
  }

  /** Write one decoded message. `replay` text is already-rendered history — written verbatim. */
  const handleText = (text: string, replay: boolean) => {
    appendScrollback(text)
    scheduleScrollbackSave()
    if (replay) {
      // Scrollback that was already rendered once (an attach replay, or restored history). It is
      // fed to the highlighter with colouring OFF so its escape-sequence state still matches the
      // screen, and the ORIGINAL text is written: running an 8-alternation regex with a lookbehind
      // over a quarter of a megabyte, synchronously, was most of the freeze on attach/detach.
      highlighter.transform(text, false)
      writeChunked(term, text)
      return
    }
    // Chunked as well: one huge message (a `cat` of a big file, a build log dumping at once) blocks a
    // frame no matter where it came from. Text at or below the chunk size passes through as-is.
    writeChunked(term, highlighter.transform(text, smartColors()))
  }

  const cleanupData = api.onData((data: Uint8Array) => {
    if (!sawFirstData) {
      sawFirstData = true
      onStatus('connected')
    }
    const text = decoder.decode(data, { stream: true })
    const replay = expectingReplay
    expectingReplay = false
    if (gated !== null) {
      gated.push(text)
      gatedReplay.push(replay)
      return
    }
    handleText(text, replay)
  })

  const cleanupError = api.onError((err: string) => {
    setStreamActive(false)
    onStatus('error')
    term.write('\r\n\x1b[31mError: ' + err + '\x1b[0m\r\n')
  })

  // The session is over: the shell is gone, so keystrokes have nowhere to go. Retire the pane's input
  // instead of leaving a blinking cursor that reads as a live prompt — a pane sitting on a finished
  // script's `pause` looked identical to one that had frozen, and every key typed into it was
  // silently dropped by the backend ("Session not found").
  const markExited = (code?: number) => {
    setStreamActive(false)
    term.options.cursorBlink = false
    term.options.disableStdin = true
    term.write(code === undefined
      ? '\r\n\x1b[33mConnection closed\x1b[0m\r\n'
      : `\r\n\x1b[33mConnection closed (exit code ${code})\x1b[0m\r\n`)
  }

  const cleanupClosed = api.onClosed((code?: number) => {
    onStatus('closed')
    markExited(code)
    onExit(code ?? 0)
  })

  // Metrics (latency + remote CPU/RAM/disk) are SSH-only; local shells have no remote host.
  const cleanupMetrics = isLocal
    ? () => {}
    : window.omnitermAPI.connect.onSessionMetrics(id, onMetrics)

  // Busy/idle is the mirror image: local-only, since it is the host's process tree being watched.
  // Output bytes no longer drive the dot — only the backend's process-tree probe does, so the dot
  // reflects a real running child (vim, ssh, a build tool, an agent CLI) and not the shell's own
  // echo of the user's typing.
  const cleanupActivity = isLocal
    ? window.omnitermAPI.connect.onLocalActivity(id, setStreamActive)
    : () => {}

  // A restored pane repaints its saved history before anything the new PTY emits. `gated` is
  // non-null only for this case; once the read settles the saved text is written and everything
  // parked while waiting is released through the normal path, in arrival order.
  if (gated !== null && scrollbackKey) {
    const key = scrollbackKey
    void loadScrollback(key).then(saved => {
      if (!isCurrent()) return // torn down while awaiting
      if (saved) scrollBuffer = saved
      if (scrollBuffer) {
        // The seed is already the saved buffer — write it verbatim, no re-append.
        highlighter.transform(scrollBuffer, false)
        writeChunked(term, scrollBuffer)
      }
      const queued = gated ?? []
      const queuedReplay = gatedReplay
      gated = null
      gatedReplay = []
      queued.forEach((text, i) => handleText(text, queuedReplay[i]))
      refit()
    })
  }

  // Start (or attach to) the session. Every output listener above is registered FIRST, so attach's
  // replay and its live subscription cannot miss bytes emitted between the two.
  if (mode === 'attach') {    // Bind to the existing backend session: replay its buffer and restore its status, never
    // reconnect. The backend only resumes live delivery once resume() is called, so nothing streams
    // before this subscription exists.
    onStatus('connecting')
    refit()
    expectingReplay = true
    void window.omnitermAPI.terminalWindow.resume(id)
      .finally(() => { expectingReplay = false })
      .then((snapshot) => {
        if (!isCurrent()) return // torn down while awaiting
        if (!snapshot) {
          onStatus('error')
          term.write('\r\n\x1b[31mError: session is no longer available\x1b[0m\r\n')
          return
        }
        // Normally empty: the replay rides the data channel above, not this result (see
        // omnitermAPI.ts). Handled the same way regardless, so a backend that ever does inline it
        // cannot reintroduce the single-huge-write freeze.
        if (snapshot.data && snapshot.data.length > 0) {
          sawFirstData = true
          handleText(decoder.decode(snapshot.data, { stream: true }), true)
        }
        if (snapshot.status === 'ready') onStatus('connected')
        else if (snapshot.status === 'error') {
          onStatus('error')
          if (snapshot.error) term.write('\r\n\x1b[31mError: ' + snapshot.error + '\x1b[0m\r\n')
        } else if (snapshot.status === 'closed') {
          onStatus('closed')
          markExited()
        }
        refit()
      })
  } else {
    onStatus('connecting')
    api.connect()
  }

  return {
    dispose: () => {
      cleanupReady()
      cleanupData()
      cleanupError()
      cleanupClosed()
      cleanupMetrics()
      cleanupActivity()
      // Final scrollback flush — unmount is the last moment the full buffer is owned here.
      if (scrollTimer) clearTimeout(scrollTimer)
      scrollTimer = null
      if (scrollbackKey && scrollDirty) {
        scrollDirty = false
        void saveScrollback(scrollbackKey, scrollBuffer)
      }
    },
    noteLocalEcho: () => highlighter.noteLocalEcho(),
  }
}
