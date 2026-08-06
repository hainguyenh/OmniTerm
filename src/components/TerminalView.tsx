import React, { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { resolveShortcuts, matchesChromeShortcut } from '../utils/shortcuts'
import { clipboardActionFor } from '../utils/paste'
import { enterSequenceFor, EnterModes, DEFAULT_ENTER_MODES } from '../utils/enterKeys'
import { normalizeXtermTheme } from '../utils/xtermTheme'
import { createCoalescer } from '../utils/coalesce'
import { createWebglController } from '../utils/webglController'
import { createSessionChannel } from '../utils/sessionChannel'
import { createTerminalOptions, DEFAULT_MONO_STACK } from '../utils/terminalOptions'
import { createTerminalClipboard } from '../utils/terminalClipboard'
import { attachTerminalStream } from '../utils/terminalStream'
import '@xterm/xterm/css/xterm.css'
import { Connection, SessionStatus } from './MainLayout'
import { TerminalTheme, TOKYO_NIGHT } from '../themes'

export { DEFAULT_MONO_STACK }

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
   * Reports a font-size change made inside the terminal (Ctrl+wheel) as an absolute size, so the
   * owner can persist the override and keep its own display in sync. Without this the wheel would
   * mutate only this xterm instance and the change would be lost on the next remount.
   */
  onFontSizeChange?: (size: number) => void
  /**
   * 'connect' (default) starts a fresh SSH/PTY session. 'attach' binds to an already-running
   * session owned by the main process (used when a session is popped out into a detached window
   * or folded back into the main window): it replays the buffered output and subscribes to live
   * data WITHOUT reconnecting, so the underlying process is never duplicated.
   */
  mode?: 'connect' | 'attach'
  /**
   * Is this pane currently on screen? Panes not in a visible slot stay mounted (so their session
   * keeps streaming) but are hidden with `visibility: hidden`, which — unlike `display: none` —
   * leaves clientWidth/Height intact. That is what keeps xterm's scroll position and cell grid
   * correct across a tab switch, and it is also why the pane's own geometry can no longer tell it
   * whether it is visible: this prop is the signal instead. Defaults to true for owners with a
   * single always-visible pane (DetachedTerminalWindow).
   */
  active?: boolean
  shortcuts?: ShortcutBindings
  /**
   * What Shift+Enter and Ctrl+Enter send. xterm collapses both to a bare `\r`, so AI agents cannot
   * tell them from a plain Enter without the app injecting a sequence — see utils/enterKeys.ts.
   */
  enterModes?: EnterModes
}

const TerminalView: React.FC<TerminalViewProps> = ({ id, connection, onStatus, onMetrics, onActivity, onExit, theme, fontSize, smartColors, fontFamilyMono, onFontSizeChange, mode = 'connect', active = true, shortcuts, enterModes }) => {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  // Set by the main effect; lets the fontSize effect refit without re-running it.
  const safeFitRef = useRef<() => void>(() => {})
  // Was the pane pinned to the live tail when it was last hidden? Re-showing scrolls back down only
  // if it was — a user who had scrolled up to read history must not be yanked to the bottom.
  const wasAtBottomRef = useRef(true)
  const wasActiveRef = useRef(active)
  // Set by the main effect. Lets the visibility effect keep this pane at the front of the shared
  // WebGL budget without re-running the main effect.
  const touchRendererRef = useRef<() => void>(() => {})
  const activeRef = useRef(active)
  activeRef.current = active

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

  const onFontSizeChangeRef = useRef(onFontSizeChange)
  onFontSizeChangeRef.current = onFontSizeChange

  // The main effect's deps are [id, connection, mode], so its key handler closes over whatever these
  // were at mount. Reading them through refs is the only way a settings change reaches a live pane.
  const enterModesRef = useRef(enterModes)
  enterModesRef.current = enterModes

  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  // Apply theme changes dynamically without recreating the terminal.
  useEffect(() => {
    if (termRef.current && theme) {
      termRef.current.options.theme = normalizeXtermTheme(theme)
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

    const isLocal = connection.type === 'LOCAL'

    const term = new Terminal(createTerminalOptions({
      isLocal, fontSize, fontFamilyMono, theme: theme ?? TOKYO_NIGHT.terminal.dark,
    }))

    termRef.current = term

    const api = createSessionChannel(isLocal, id, connection.id, connection.shell)

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    // Fixes box-drawing/emoji width measurement — agent TUIs lean on both, and the default table
    // mis-measures wide glyphs, itself a source of garbled output.
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'

    // Not reloaded per visibility edge — rebuilding the texture atlas on each tab switch painted a
    // flash. utils/webglPool.ts owns the context budget; loss/eviction retries on the next active
    // fit. Loaded from `safeFit`, because the addon needs real dimensions.
    const webglController = createWebglController(term)
    touchRendererRef.current = webglController.touch

    // Fit only when the container has a real size — before the first layout pass, and while a
    // detached window is still being sized, clientWidth/Height are 0 and fit() would crash xterm's
    // renderer. The ResizeObserver re-fits once real dimensions exist or the window resizes.
    //
    // This is NOT a visibility check any more: a hidden pane deliberately keeps its layout box (see
    // the `active` prop), so geometry cannot distinguish "off screen" from "on screen". Focus is
    // driven by `active` alone — deriving it from geometry here would let a pane that mounted while
    // hidden steal focus from the visible one.
    let wasUnsized = true
    // Skip re-sending identical dimensions: a ConPTY resize is expensive and each one makes a
    // full-screen TUI repaint, so a fit() that lands on the same cols/rows (e.g. a pixel-size change
    // that didn't cross a cell boundary) must not trigger one.
    let lastCols = -1
    let lastRows = -1
    let lastClientWidth = -1
    let lastClientHeight = -1
    const safeFit = () => {
      const el = terminalRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) {
        wasUnsized = true
        return
      }

      const pixelSizeChanged = el.clientWidth !== lastClientWidth || el.clientHeight !== lastClientHeight
      lastClientWidth = el.clientWidth
      lastClientHeight = el.clientHeight

      if (wasUnsized) {
        wasUnsized = false
        // First real dimensions: the renderer can measure a cell now.
      }
      if (activeRef.current) webglController.load()
      try {
        fitAddon.fit()
        if (term.cols !== lastCols || term.rows !== lastRows) {
          lastCols = term.cols
          lastRows = term.rows
          api.resize({ cols: term.cols, rows: term.rows })
          return
        }
        // Only the case the resize above did NOT cover: the pixel size changed but cols/rows didn't,
        // so nothing downstream repaints on its own. A cols/rows change already triggers a full
        // repaint via term.resize(), and repainting twice per drag-resize frame — which is what this
        // did unconditionally, alongside a clearTextureAtlas() that threw away every cached glyph —
        // is the lag. Never synthesize a keystroke to force a repaint either: it would corrupt the
        // agent's own input state.
        if (pixelSizeChanged) {
          term.refresh(0, term.rows - 1)
        }
      } catch {
        /* terminal not ready / not visible yet — ignore */
      }
    }
    safeFitRef.current = safeFit
    // Coalesces a drag-resize's burst of ResizeObserver callbacks into one settled fit — see coalesce.ts.
    const fitCoalescer = createCoalescer(safeFit, 70)

    term.onData(data => {
      api.input(data)
    })

    // Selection auto-copy + paste. The key bindings that reach these live in the handler below.
    // The indirection exists because the highlighter a paste has to quiet lives in the stream below,
    // which cannot be created until this pane's fit/resize plumbing is in place.
    let noteLocalEcho = () => {}
    const clipboard = createTerminalClipboard(term, () => noteLocalEcho())

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      term.focus()
      void clipboard.paste()
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

    // WebView zoom (App.tsx / DetachedTerminalWindow.tsx) changes CSS pixel density with no DOM
    // resize event, so xterm's cached char measurement goes stale — part of why detaching a window
    // "fixes" a garbled pane, since remounting re-measures fresh. Toggling `fontFamily` forces the
    // same re-measure publicly: its option setter skips the work when the value doesn't change.
    //
    // Coalesced, because a re-measure re-rasterizes every glyph: holding Ctrl+wheel fires one zoom
    // step per notch, and doing this on each one is the same kind of thrash the ResizeObserver had.
    const remeasureCoalescer = createCoalescer(() => {
      const family = term.options.fontFamily
      term.options.fontFamily = `${family} `
      term.options.fontFamily = family
      safeFit()
    }, 70)
    const onZoomChanged = () => remeasureCoalescer.schedule()
    window.addEventListener('omniterm:zoom-changed', onZoomChanged)

    // Fonts loaded asynchronously (like Cascadia Code) cause xterm to initially measure characters
    // using a fallback font. When the real font finally paints, the canvas grid size doesn't match
    // the text size, causing overlapped and fragmented text until a resize forces a remeasure.
    let fontsReady = false
    document.fonts?.ready?.then(() => {
      if (!fontsReady) {
        fontsReady = true
        remeasureCoalescer.schedule()
      }
    })


    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        // Stop this from also reaching the app-level Ctrl+wheel zoom handler (App.tsx) — over a
        // terminal, Ctrl+wheel changes only its font size, never the app chrome's zoom too.
        e.stopPropagation()
        const currentSize = term.options.fontSize ?? 14
        // Same 8–48 range as the app's font controls; the new size is reported up so the owner can
        // persist the override (the change stays visible in the footer/title bar, and survives remounts).
        const newSize = e.deltaY > 0 ? Math.max(8, currentSize - 1) : Math.min(48, currentSize + 1)
        if (newSize !== currentSize) {
          term.options.fontSize = newSize
          // safeFit, not a bare fitAddon.fit(): without the follow-up api.resize() the PTY kept the
          // pre-zoom cols/rows, and a full-screen TUI drew frames for a grid that no longer existed.
          safeFit()
          onFontSizeChangeRef.current?.(newSize)
        }
      }
    }
    termEl.addEventListener('wheel', handleWheel, { passive: false })

    const isMac = window.omnitermAPI.app.platform === 'darwin'

    term.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown') return true

      // Claimed FIRST so no user binding can shadow it, always with preventDefault() — otherwise
      // Chromium's native paste fires on top of ours and the PTY gets the clipboard twice (paste.ts).
      const clip = clipboardActionFor(e, isMac)
      if (clip) {
        e.preventDefault()
        e.stopPropagation()
        if (clip === 'paste') void clipboard.paste()
        else clipboard.copySelection()
        return false
      }

      // ── Modifier+Enter ─────────────────────────────────────
      // Also before the shortcut check: xterm would otherwise flatten these to a plain `\r`.
      // `term.input` (not api.input) so the viewport scrolls to the bottom like real typing.
      const seq = enterSequenceFor(e, enterModesRef.current ?? DEFAULT_ENTER_MODES)
      if (seq !== null) {
        e.preventDefault()
        term.input(seq)
        return false
      }

      // Let app-level shortcuts bubble up to the window handler — EXCEPT the ones that survive
      // terminal focus (the zoom trio, and any Ctrl+Shift/Alt combo), which stay xterm's business so
      // the shell/agent underneath keeps its own Ctrl+W / Ctrl+B / Ctrl+N / Ctrl+P / Ctrl+/ / Ctrl+,.
      // Reads the same table `useAppShortcuts` matches against (utils/shortcuts.ts) so the two sides
      // cannot disagree about what counts as a chrome shortcut.
      const s = resolveShortcuts(shortcutsRef.current)
      if (matchesChromeShortcut(e, s, { inTerminal: true })) {
        return false // Don't let xterm swallow it; let it bubble to window keydown
      }

      return true
    })

    // Status + output + exit + the two side channels, and the connect-or-attach kickoff. See
    // utils/terminalStream.ts — the byte path lives there because none of it is React's business.
    const stream = attachTerminalStream({
      term, api, id, isLocal, host: connection.host, mode,
      onStatus: (s) => onStatusRef.current?.(s),
      onExit: (code) => onExitRef.current?.(code),
      onMetrics: (m) => onMetricsRef.current?.(m),
      onActivity: (busy) => onActivityRef.current?.(busy),
      smartColors: () => smartColorsRef.current === true,
      refit: () => safeFit(),
      isCurrent: () => termRef.current === term,
    })
    noteLocalEcho = stream.noteLocalEcho

    // Coalesced (not raw safeFit): a drag-resize fires this on every intermediate frame, and
    // fitting/resizing on each one is itself a source of TUI frame corruption.
    const ro = new ResizeObserver(() => fitCoalescer.schedule())
    ro.observe(terminalRef.current)
    // Defer the first fit until after layout so dimensions are valid. Immediate, not coalesced —
    // there's nothing to collapse a burst with yet.
    const raf = requestAnimationFrame(safeFit)

    return () => {
      cancelAnimationFrame(raf)
      fitCoalescer.cancel()
      remeasureCoalescer.cancel()
      ro.disconnect()
      clipboard.dispose()
      termEl.removeEventListener('contextmenu', onContextMenu)
      termEl.removeEventListener('wheel', handleWheel)
      window.removeEventListener('omniterm:focus-terminal', onFocusEvent)
      window.removeEventListener('omniterm:zoom-changed', onZoomChanged)
      stream.dispose()
      safeFitRef.current = () => {}
      touchRendererRef.current = () => {}
      termRef.current = null
      webglController.unload()
      term.dispose()
    }
  }, [id, connection, mode])

  // Visibility edges. Declared after the main effect so `termRef` is already populated on mount.
  //
  // Focus follows visibility: `term.open()` does not focus, so a pane the user switched to rather
  // than clicked into would get no keys (a script sitting on `pause` looked frozen). Geometry used
  // to stand in for this signal, but a hidden pane now keeps its real size on purpose — see the
  // `active` prop.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const buffer = term.buffer?.active
    const becameActive = active && !wasActiveRef.current
    wasActiveRef.current = active
    if (!active) {
      if (buffer) wasAtBottomRef.current = buffer.viewportY >= buffer.baseY
      return
    }
    term.focus()
    // The pane the user is looking at must be the last to lose hardware rendering.
    touchRendererRef.current()
    if (becameActive) safeFitRef.current()
    // Belt and braces for the scroll bug the `.pane-offscreen` rule fixes: even if some future
    // change collapses the pane again, a tab the user left at the live tail comes back to it.
    if (wasAtBottomRef.current) term.scrollToBottom?.()
  }, [active])

  return (
    <div
      className="terminal-pane h-full w-full"
      style={{
        background: theme?.background ?? '#1a1b26',
        // Reads the same token the removed `.p-2` class did, but as an inline style: `.p-2` is a
        // shared utility class used all over the app's chrome, and `fitAddon.fit()` measures this
        // exact box, so tying its padding to a class meant for unrelated elements is fragile — a
        // future change to that shared rule would silently resize every terminal pane along with it.
        padding: 'var(--theme-padding-sm)',
        // index.css scopes `.xterm *`'s font-family to this variable (falling back to the app-wide
        // one) so xterm always measures cells with the SAME font it renders with. Kept in sync with
        // the literal handed to `new Terminal({ fontFamily })` above via DEFAULT_MONO_STACK — letting
        // those two drift is what caused glyphs to be measured at one width and drawn at another.
        '--pane-font-mono': fontFamilyMono ?? DEFAULT_MONO_STACK,
      } as React.CSSProperties}
    >
      <div ref={terminalRef} className="h-full w-full" />
    </div>
  )
}

export default TerminalView
