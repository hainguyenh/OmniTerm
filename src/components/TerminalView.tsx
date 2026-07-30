import React, { useEffect, useRef } from 'react'
import { Terminal, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { matchShortcut } from '../utils/keyboard'
import '@xterm/xterm/css/xterm.css'
import { Connection, SessionStatus } from './MainLayout'
import { TerminalTheme, TOKYO_NIGHT } from '../themes'
import { OutputHighlighter } from '../highlighter'

interface TerminalViewProps {
  id: string
  connection: Connection
  onStatus?: (status: SessionStatus) => void
  /** Live session metrics (latency + remote CPU/RAM/disk) pushed from the main process. */
  onMetrics?: (m: SessionMetrics) => void
  /**
   * The shell started/stopped running something. LOCAL only (it needs a process-tree probe on the
   * host), and only under the Tauri backend — elsewhere it simply never fires.
   */
  onActivity?: (busy: boolean) => void
  /**
   * The pane's process ended, carrying its exit status. Separate from `onStatus('closed')` because the
   * status alone cannot tell a script that finished from one that failed — see sessionExit.ts.
   */
  onExit?: (code: number) => void
  theme?: TerminalTheme
  fontSize?: number
  /** Client-side editor-style coloring of plain output (errors, numbers, paths…). */
  smartColors?: boolean
  fontFamilyMono?: string
  /**
   * 'connect' (default) starts a fresh SSH/PTY session. 'attach' binds to an already-running
   * session owned by the main process (used when a session is popped out into a detached window
   * or folded back into the main window): it replays the buffered output and subscribes to live
   * data WITHOUT reconnecting, so the underlying process is never duplicated.
   */
  mode?: 'connect' | 'attach'
  shortcuts?: ShortcutBindings
}

/** Theme JSON allows '' for optional colors; xterm wants the key absent instead. */
const toXtermTheme = (t: TerminalTheme): ITheme => {
  const { selectionForeground, ...rest } = t
  return selectionForeground ? { ...rest, selectionForeground } : rest
}

const TerminalView: React.FC<TerminalViewProps> = ({ id, connection, onStatus, onMetrics, onActivity, onExit, theme, fontSize, smartColors, fontFamilyMono, mode = 'connect', shortcuts }) => {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  // Set by the main effect; lets the fontSize effect refit without re-running it.
  const safeFitRef = useRef<() => void>(() => {})

  // Read at write-time so the toggle applies to live sessions immediately.
  const smartColorsRef = useRef(smartColors)
  smartColorsRef.current = smartColors

  // Stable refs so callbacks don't re-trigger the main effect.
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  const onMetricsRef = useRef(onMetrics)
  onMetricsRef.current = onMetrics

  const onActivityRef = useRef(onActivity)
  onActivityRef.current = onActivity

  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  // Apply theme changes dynamically without recreating the terminal.
  useEffect(() => {
    if (termRef.current && theme) {
      termRef.current.options.theme = toXtermTheme(theme)
    }
  }, [theme])

  // Apply font size changes dynamically. Must re-fit afterwards: xterm keeps
  // cols/rows when only the font changes, so without fit() the canvas would
  // overflow its container instead of reflowing to fewer/more cells.
  useEffect(() => {
    if (termRef.current && fontSize) {
      termRef.current.options.fontSize = fontSize
      requestAnimationFrame(() => safeFitRef.current())
    }
  }, [fontSize])

  // Apply font family changes dynamically.
  useEffect(() => {
    if (termRef.current && fontFamilyMono) {
      termRef.current.options.fontFamily = fontFamilyMono
      requestAnimationFrame(() => safeFitRef.current())
    }
  }, [fontFamilyMono])

  useEffect(() => {
    if (!terminalRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: fontSize ?? 14,
      fontFamily: fontFamilyMono ?? '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, "Courier New", monospace',
      letterSpacing: 0,
      lineHeight: 1.15,
      theme: toXtermTheme(theme ?? TOKYO_NIGHT.terminal.dark),
    })

    termRef.current = term

    // Channel adapter: SSH sessions talk to the ssh:* IPC, LOCAL (WSL/PowerShell/CMD)
    // sessions to the local:* ConPTY IPC. Same streaming shape, so the rest of the
    // terminal wiring is identical. Metrics are SSH-only.
    const isLocal = connection.type === 'LOCAL'
    const api = isLocal
      ? {
          // id is this instance's session key (unique per tab); connection.id is the saved
          // connection to load settings from — they diverge when the same LOCAL connection
          // is running as more than one independent instance (see MainLayout's activeTabs).
          connect: () => window.omnitermAPI.connect.local(id, connection.id, connection.shell),
          input: (d: string) => window.omnitermAPI.connect.localInput(id, d),
          resize: (s: { cols: number; rows: number }) => window.omnitermAPI.connect.localResize(id, s),
          onReady: (cb: (label?: string) => void) => window.omnitermAPI.connect.onLocalReady(id, cb),
          onData: (cb: (data: Uint8Array) => void) => window.omnitermAPI.connect.onLocalData(id, cb),
          onError: (cb: (err: string) => void) => window.omnitermAPI.connect.onLocalError(id, cb),
          onClosed: (cb: (code?: number) => void) => window.omnitermAPI.connect.onLocalClosed(id, cb),
        }
      : {
          connect: () => window.omnitermAPI.connect.ssh(id),
          input: (d: string) => window.omnitermAPI.connect.sshInput(id, d),
          resize: (s: { cols: number; rows: number }) => window.omnitermAPI.connect.sshResize(id, s),
          onReady: (cb: (label?: string) => void) => window.omnitermAPI.connect.onSSHReady(id, () => cb()),
          onData: (cb: (data: Uint8Array) => void) => window.omnitermAPI.connect.onSSHData(id, cb),
          onError: (cb: (err: string) => void) => window.omnitermAPI.connect.onSSHError(id, cb),
          // SSH reports no status of its own, so a closed channel is reported as a clean exit.
          onClosed: (cb: (code?: number) => void) => window.omnitermAPI.connect.onSSHClosed(id, () => cb(0)),
        }

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)

    // Fit only when the container is actually visible with a real size.
    // When a tab is hidden (display:none) clientWidth/Height are 0 and fit()
    // would crash xterm's renderer ("Cannot read properties of undefined
    // (reading 'dimensions')"). The ResizeObserver re-fits when the tab
    // becomes visible or the window resizes.
    // Keyboard focus follows visibility: `term.open()` does not focus, so a pane the user did not
    // click into gets no keys at all — typing goes to the document and the shell never sees it, which
    // is why a script sitting on `pause` looked frozen. Focusing on the hidden→visible edge covers
    // both the first mount and every later tab switch, and cannot fight the user for focus while a
    // pane is already up.
    let wasHidden = true
    const safeFit = () => {
      const el = terminalRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) {
        wasHidden = true
        return
      }
      if (wasHidden) {
        wasHidden = false
        term.focus()
      }
      try {
        fitAddon.fit()
        api.resize({ cols: term.cols, rows: term.rows })
      } catch {
        /* terminal not ready / not visible yet — ignore */
      }
    }
    safeFitRef.current = safeFit

    term.onData(data => {
      api.input(data)
    })

    // ── Clipboard ──────────────────────────────────────────
    // Selecting text auto-copies it; right-click pastes. Ctrl+Shift+C / Ctrl+Shift+V
    // also work. Plain Ctrl+C is NOT intercepted so it still sends SIGINT.
    const selectionDisposable = term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) window.omnitermAPI.clipboard.writeText(sel)
    })

    const pasteFromClipboard = async () => {
      const text = await window.omnitermAPI.clipboard.readText()
      if (text) api.input(text)
    }

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      term.focus()
      void pasteFromClipboard()
    }
    const termEl = terminalRef.current
    termEl.addEventListener('contextmenu', onContextMenu)

    // There is no sudo-password helper. It typed a *stored* credential into the pane, and this app
    // stores none — the user types their own password at the prompt, which is also the only way it
    // never exists anywhere but the terminal.

    // Refocus after the parent's confirm dialog closes so Enter lands here.
    const onFocusEvent = (e: Event) => {
      if ((e as CustomEvent).detail?.id === id) term.focus()
    }
    window.addEventListener('omniterm:focus-terminal', onFocusEvent)

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        const currentSize = term.options.fontSize ?? 14
        const newSize = e.deltaY > 0 ? Math.max(6, currentSize - 1) : Math.min(100, currentSize + 1)
        if (newSize !== currentSize) {
          term.options.fontSize = newSize
          try { fitAddon.fit() } catch (e) { /* ignore */ }
        }
      }
    }
    termEl.addEventListener('wheel', handleWheel, { passive: false })

    term.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown') return true
      
      // Allow app-level shortcuts to bubble up
      const s = shortcuts || {
        zoomIn: 'Ctrl+=',
        zoomOut: 'Ctrl+-',
        newSession: 'Ctrl+N',
        newFolder: 'Ctrl+Shift+N',
        openSettings: 'Ctrl+,',
        toggleThemeMode: 'Ctrl+/',
        layout1: 'Ctrl+1',
        layout2: 'Ctrl+2',
        layout4: 'Ctrl+4',
        layout6: 'Ctrl+6',
        layout8: 'Ctrl+8',
        toggleSidebar: 'Ctrl+B',
        commandPalette: 'CommandOrControl+P',
        closeTab: 'Ctrl+W'
      }
      const isAppShortcut = Object.values(s).some(shortcut => shortcut && matchShortcut(e, shortcut))
      if (isAppShortcut) {
        return false // Don't let xterm swallow it; let it bubble to window keydown
      }

      // Ctrl+Shift+C — copy selection (plain Ctrl+C stays SIGINT)
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyC') {
        const sel = term.getSelection()
        if (sel) window.omnitermAPI.clipboard.writeText(sel)
        return false
      }
      // Ctrl+Shift+V — paste
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyV') {
        void pasteFromClipboard()
        return false
      }
      return true
    })

    // LOCAL only: ConPTY spawns the child (e.g. wsl.exe) almost instantly, but the shell
    // behind it can take much longer to actually produce a prompt — a cold WSL VM boot in
    // particular can take several seconds of total silence. Keep the 'connecting' status
    // (and its loading overlay) up until the first real output arrives, instead of flipping
    // to 'connected' on the handshake and leaving the pane looking blank the whole time.
    // SSH's shell channel reliably sends a prompt/MOTD immediately, so it keeps the old
    // ready-is-connected behavior.
    let sawFirstData = !isLocal

    const cleanupReady = api.onReady((label?: string) => {
      if (!isLocal) onStatusRef.current?.('connected')
      const banner = isLocal
        ? (label ?? 'Local shell')
        : 'Connected to ' + connection.host
      term.write('\r\n\x1b[32m' + banner + '\x1b[0m\r\n')
      safeFit()
    })

    // Stream pipeline: bytes → UTF-8 text (streaming decoder handles chunk-split
    // multibyte chars) → optional smart coloring → terminal. The highlighter
    // always sees the text so its escape-sequence state stays in sync even
    // while the toggle is off.
    const decoder = new TextDecoder('utf-8')
    const highlighter = new OutputHighlighter()
    const cleanupData = api.onData((data: Uint8Array) => {
      if (!sawFirstData) {
        sawFirstData = true
        onStatusRef.current?.('connected')
      }
      const text = decoder.decode(data, { stream: true })
      term.write(highlighter.transform(text, smartColorsRef.current !== false))
    })

    const cleanupError = api.onError((err: string) => {
      onStatusRef.current?.('error')
      term.write('\r\n\x1b[31mError: ' + err + '\x1b[0m\r\n')
    })

    // The session is over: the shell is gone, so keystrokes have nowhere to go. Retire the pane's
    // input instead of leaving a blinking cursor that reads as a live prompt — a pane sitting on a
    // finished script's `pause` looked identical to one that had frozen, and every key typed into it
    // was silently dropped by the backend ("Session not found").
    const markExited = (code?: number) => {
      term.options.cursorBlink = false
      term.options.disableStdin = true
      term.write(code === undefined
        ? '\r\n\x1b[33mConnection closed\x1b[0m\r\n'
        : `\r\n\x1b[33mConnection closed (exit code ${code})\x1b[0m\r\n`)
    }

    const cleanupClosed = api.onClosed((code?: number) => {
      onStatusRef.current?.('closed')
      markExited(code)
      onExitRef.current?.(code ?? 0)
    })

    // Metrics (latency + remote CPU/RAM/disk) are SSH-only; local shells have no remote host.
    const cleanupMetrics = isLocal
      ? () => {}
      : window.omnitermAPI.connect.onSessionMetrics(id, (m) => {
          onMetricsRef.current?.(m)
        })

    // Busy/idle is the mirror image: local-only, since it is the host's process tree being watched.
    const cleanupActivity = isLocal
      ? window.omnitermAPI.connect.onLocalActivity(id, (busy) => { onActivityRef.current?.(busy) })
      : () => {}

    // Start (or attach to) the session. All output listeners are registered above FIRST, so
    // attach's replay + live subscription can't miss bytes emitted between the two.
    if (mode === 'attach') {
      // Bind to the existing main-process session: replay its buffer and restore its status,
      // never reconnect. The main process only resumes live delivery once resume() is called,
      // so nothing streams before this subscription exists.
      onStatusRef.current?.('connecting')
      void window.omnitermAPI.terminalWindow.resume(id).then((snapshot) => {
        if (termRef.current !== term) return  // effect torn down while awaiting
        if (!snapshot) {
          onStatusRef.current?.('error')
          term.write('\r\n\x1b[31mError: session is no longer available\x1b[0m\r\n')
          return
        }
        if (snapshot.data && snapshot.data.length > 0) {
          sawFirstData = true
          const text = decoder.decode(snapshot.data, { stream: true })
          term.write(highlighter.transform(text, smartColorsRef.current !== false))
        }
        if (snapshot.status === 'ready') onStatusRef.current?.('connected')
        else if (snapshot.status === 'error') {
          onStatusRef.current?.('error')
          if (snapshot.error) term.write('\r\n\x1b[31mError: ' + snapshot.error + '\x1b[0m\r\n')
        } else if (snapshot.status === 'closed') {
          onStatusRef.current?.('closed')
          markExited()
        }
        safeFit()
      })
    } else {
      onStatusRef.current?.('connecting')
      api.connect()
    }

    const ro = new ResizeObserver(() => safeFit())
    ro.observe(terminalRef.current)
    // Defer the first fit until after layout so dimensions are valid.
    const raf = requestAnimationFrame(safeFit)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      selectionDisposable.dispose()
      termEl.removeEventListener('contextmenu', onContextMenu)
      termEl.removeEventListener('wheel', handleWheel)
      window.removeEventListener('omniterm:focus-terminal', onFocusEvent)
      cleanupReady()
      cleanupData()
      cleanupError()
      cleanupClosed()
      cleanupMetrics()
      cleanupActivity()
      safeFitRef.current = () => {}
      termRef.current = null
      term.dispose()
    }
  }, [id, connection, mode])

  return (
    <div className="h-full w-full p-2" style={{ background: theme?.background ?? '#1a1b26' }}>
      <div ref={terminalRef} className="h-full w-full" />
    </div>
  )
}

export default TerminalView
