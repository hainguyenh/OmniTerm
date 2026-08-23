import React, { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { resolveShortcuts, matchesChromeShortcut } from '../utils/shortcuts'
import { clipboardActionFor } from '../utils/paste'
import { enterSequenceFor, DEFAULT_ENTER_MODES } from '../utils/enterKeys'
import { normalizeXtermTheme } from '../utils/xtermTheme'
import { createCoalescer } from '../utils/coalesce'
import { createWebglController } from '../utils/webglController'
import { createSessionChannel } from '../utils/sessionChannel'
import { createTerminalOptions, DEFAULT_MONO_STACK } from '../utils/terminalOptions'
import { createNativePasteGate, createTerminalClipboard } from '../utils/terminalClipboard'
import { attachTerminalStream } from '../utils/terminalStream'
import { registerPlainUrlLinks } from '../utils/terminalLinks'
import '@xterm/xterm/css/xterm.css'
import { TOKYO_NIGHT } from '../themes'
import { createTerminalContextMenu, type TerminalLinkMenuState } from '../utils/createTerminalContextMenu'
import TerminalViewLinkMenuHost from './TerminalViewLinkMenuHost'
import SessionUnavailableOverlay from './SessionUnavailableOverlay'
import type { TerminalViewProps } from './TerminalView.types'

export { DEFAULT_MONO_STACK }

const TerminalView: React.FC<TerminalViewProps> = ({ id, connection, onStatus, onRestart, onMetrics, onActivity, onExit, onTitleChange, onCwdChange, theme, darkMode, fontSize, smartColors, fontFamilyMono, onFontSizeChange, mode = 'connect', active = true, layoutEpoch, shortcuts, enterModes, blurStrength = 0 }) => {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [isFocused, setIsFocused] = React.useState(false)
  const [isHovered, setIsHovered] = React.useState(false)
  const [sessionUnavailable, setSessionUnavailable] = React.useState(false)
  // The pane owns its right-click link/path menu. Set by the contextmenu handler; cleared by the
  // host (Escape / outside click / item picked).
  const [linkMenu, setLinkMenu] = React.useState<TerminalLinkMenuState | null>(null)
  // Set by the main effect; lets the fontSize effect refit without re-running it.
  const safeFitRef = useRef<() => void>(() => {})
  // Was the pane pinned to the live tail when it was last hidden? Re-showing scrolls back down only
  // if it was — a user who had scrolled up to read history must not be yanked to the bottom.
  const wasAtBottomRef = useRef(true)
  const wasActiveRef = useRef(active)
  const layoutEpochRef = useRef(layoutEpoch)
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

  const onRestartRef = useRef(onRestart)
  onRestartRef.current = onRestart

  const onMetricsRef = useRef(onMetrics)
  onMetricsRef.current = onMetrics

  const onActivityRef = useRef(onActivity)
  onActivityRef.current = onActivity

  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  const onCwdChangeRef = useRef(onCwdChange)
  onCwdChangeRef.current = onCwdChange

  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  const onFontSizeChangeRef = useRef(onFontSizeChange)
  onFontSizeChangeRef.current = onFontSizeChange

  useEffect(() => {
    setSessionUnavailable(false)
  }, [id, mode])

  // The main effect's deps are [id, connection, mode], so its key handler closes over whatever these
  // were at mount. Reading them through refs is the only way a settings change reaches a live pane.
  const enterModesRef = useRef(enterModes)
  enterModesRef.current = enterModes

  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  // Apply theme changes dynamically without recreating the terminal.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.minimumContrastRatio = darkMode === false ? 2.5 : 1
    if (theme) {
      term.options.theme = normalizeXtermTheme(theme, darkMode === false)
    }
  }, [theme, darkMode])

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
      isLocal, darkMode, fontSize, fontFamilyMono, theme: theme ?? TOKYO_NIGHT.terminal.dark,
    }))
    // xterm's linkHandler is a no-op — `onLinkClick` owns modifier-click activation; `registerPlainUrlLinks` keeps the hover cue (see terminalLinks.ts).
    term.options.linkHandler = { activate: () => {} }

    termRef.current = term

    const api = createSessionChannel(isLocal, id, connection.id, connection.shell, darkMode)

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    const titleDisposable = typeof term.onTitleChange === 'function'
      ? term.onTitleChange(title => onTitleChangeRef.current?.(title))
      : { dispose: () => {} }
    // Shell-reported working directory. OSC 7 is the standards-track form
    // (`file://host/path`); Windows shells and pwsh emit the OSC 9;9
    // notification instead. Both feed onCwdChange; shells that emit neither
    // simply never set a cwd label.
    const cwdDisposables: Array<{ dispose: () => void }> = []
    const parser = (term as unknown as {
      parser?: {
        registerOscHandler?: (
          ident: number,
          callback: (data: string) => boolean | Promise<boolean>,
        ) => { dispose: () => void }
      }
    }).parser
    if (parser?.registerOscHandler && onCwdChangeRef.current !== undefined) {
      const report = (rawPath: string) => {
        const cleaned = decodeURIComponent(rawPath).trim()
        if (!cleaned) return true
        const withoutScheme = cleaned.startsWith('file://')
          ? cleaned.replace(/^file:\/\/[^/]*/, '')
          : cleaned
        if (withoutScheme) onCwdChangeRef.current?.(withoutScheme)
        return false
      }
      const osc7 = parser.registerOscHandler(7, data => report(data))
      // ConEmu/Windows style CWD notification: ESC ] 9 ; 9 ; "path" ESC \ — the
      // handler for ident 9 receives everything after the first `9;`.
      const osc999 = parser.registerOscHandler(9, data =>
        data.startsWith('9;') ? report(data.slice(2).replace(/^"|"$/g, '')) : false,
      )
      cwdDisposables.push(osc7, osc999)
    }
    const plainLinkDisposable = registerPlainUrlLinks(term)
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
        return
      }

      const pixelSizeChanged = el.clientWidth !== lastClientWidth || el.clientHeight !== lastClientHeight
      lastClientWidth = el.clientWidth
      lastClientHeight = el.clientHeight

      try {
        fitAddon.fit()
        // Load the WebGL renderer AFTER fit(), so its first frame rasterizes at the real
        // cols/rows. Loading it before fit() committed a first frame at the default 80x24
        // grid; fit()'s subsequent resize repaint was then deduped against that frame, leaving
        // a freshly-launched full-screen TUI (claude, codex…) misaligned until a font-size
        // change forced a non-deduped repaint. Idempotent once held, and the same path
        // re-acquires after a context loss (drop() re-arms retryLoad).
        if (activeRef.current) webglController.load()
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

    const onFocusIn = () => setIsFocused(true)
    const onFocusOut = () => setIsFocused(false)
    terminalRef.current?.addEventListener('focusin', onFocusIn)
    terminalRef.current?.addEventListener('focusout', onFocusOut)

    // Selection auto-copy + paste. The key bindings that reach these live in the handler below.
    // The indirection exists because the highlighter a paste has to quiet lives in the stream below,
    // which cannot be created until this pane's fit/resize plumbing is in place.
    let noteLocalEcho = () => {}
    const clipboard = createTerminalClipboard(term, () => noteLocalEcho())
    let suppressNativePasteUntil = 0

    const { onContextMenu, onLinkClick } = createTerminalContextMenu({
      term,
      termElRef: terminalRef,
      clipboard,
      setLinkMenu,
      setSuppressPaste: () => { suppressNativePasteUntil = performance.now() + 250 },
    })
    const onNativePaste = createNativePasteGate({
      term,
      noteLocalEcho: () => noteLocalEcho(),
      isSuppressed: () => performance.now() <= suppressNativePasteUntil,
    })
    const termEl = terminalRef.current
    termEl.addEventListener('contextmenu', onContextMenu)
    termEl.addEventListener('mousedown', onLinkClick)
    termEl.addEventListener('paste', onNativePaste, true)
    const onMouseUp = () => { window.setTimeout(() => { if (term.hasSelection?.()) void clipboard.copySelection() }, 0) }
    termEl.addEventListener('mouseup', onMouseUp)

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
        else void clipboard.copySelection()
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
      onUnavailable: () => setSessionUnavailable(true),
      onExit: (code) => onExitRef.current?.(code),
      onMetrics: (m) => onMetricsRef.current?.(m),
      onActivity: (busy) => onActivityRef.current?.(busy),
      smartColors: () => smartColorsRef.current === true,
      refit: () => safeFit(),
      isCurrent: () => termRef.current === term,
      // Only local panes are restored across restarts, so only they carry saved scrollback.
      scrollbackKey: isLocal ? `sb-${id}` : undefined,
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
      terminalRef.current?.removeEventListener('focusin', onFocusIn)
      terminalRef.current?.removeEventListener('focusout', onFocusOut)
      plainLinkDisposable.dispose()
      titleDisposable.dispose()
      for (const disposable of cwdDisposables) disposable.dispose()
      termEl.removeEventListener('contextmenu', onContextMenu)
      termEl.removeEventListener('mousedown', onLinkClick)
      termEl.removeEventListener('paste', onNativePaste, true)
      termEl.removeEventListener('mouseup', onMouseUp)
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
    const layoutChanged = active && layoutEpochRef.current !== layoutEpoch
    wasActiveRef.current = active
    layoutEpochRef.current = layoutEpoch
    if (!active) {
      if (buffer) wasAtBottomRef.current = buffer.viewportY == null || buffer.baseY == null || buffer.viewportY >= buffer.baseY
      return
    }
    term.focus()
    // The pane the user is looking at must be the last to lose hardware rendering.
    touchRendererRef.current()
    if (becameActive || layoutChanged) safeFitRef.current()
    // Belt and braces for the scroll bug the `.pane-offscreen` rule fixes: even if some future
    // change collapses the pane again, a tab the user left at the live tail comes back to it.
    // xterm queues writes; wait for the queue before restoring a pane that was at the live tail.
    if ((becameActive || layoutChanged) && wasAtBottomRef.current) {
      term.scrollToBottom?.()
      term.write('', () => term.scrollToBottom?.())
    } else if (wasAtBottomRef.current) {
      term.scrollToBottom?.()
    }
  }, [active, layoutEpoch])

  return (
    <div
      className="terminal-pane relative h-full w-full"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
        filter: blurStrength > 0 && !isFocused && !isHovered ? `blur(${blurStrength}px)` : 'none',
        transition: 'filter 120ms ease-out',
      } as React.CSSProperties}
    >
      <div ref={terminalRef} className="h-full w-full" />
      {sessionUnavailable && onRestartRef.current && (
        <SessionUnavailableOverlay onRestart={() => onRestartRef.current?.()} />
      )}
      <TerminalViewLinkMenuHost
        menu={linkMenu}
        isLocal={connection.type === 'LOCAL'}
        onClose={() => setLinkMenu(null)}
      />
    </div>
  )
}

export default TerminalView
