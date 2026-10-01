import React, { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { noteSubmittedInput, onAgentLaunch } from '../utils/agentLaunchSignal'
import { interceptPaneInput } from '../utils/paneInputHold'
import { registerPaneScreen } from '../utils/paneScreens'
import { imagePasteModeFor, latchAgent } from '../utils/agentRegistry'
import { parseAgentTitle } from '../utils/agentTitle'
import { getPanePresence } from '../utils/agentPresenceStore'
import { findSessionByTabId } from '../utils/agentSessionStorage'
import { normalizeXtermTheme } from '../utils/xtermTheme'
import { createCoalescer } from '../utils/coalesce'
import { createWebglController } from '../utils/webglController'
import { createSessionChannel } from '../utils/sessionChannel'
import { createTerminalOptions, DEFAULT_MONO_STACK, resolveTerminalFontFamily } from '../utils/terminalOptions'
import { createNativePasteGate, createTerminalClipboard, writeClipboardText } from '../utils/terminalClipboard'
import { recordPastedImage, recordSavedAttachments, releaseSessionMedia } from '../utils/sessionAttachmentStore'
import { attachTerminalStream } from '../utils/terminalStream'
import { registerPlainUrlLinks } from '../utils/terminalLinks'
import '@xterm/xterm/css/xterm.css'
import { TOKYO_NIGHT } from '../themes'
import { createTerminalContextMenu, type TerminalLinkMenuState } from '../utils/createTerminalContextMenu'
import { registerCwdReporting } from '../utils/terminalCwdReporting'
import { createAltClickMoveHandler } from '../terminal/altClickNavigation'
import { createCtrlWheelFontResizer } from '../terminal/ctrlWheelFontResize'
import { createTerminalKeyHandler } from '../terminal/terminalKeyHandler'
import { bufferText, createLastOutputTracker, registerTerminalCopyHandler, viewportText } from '../utils/terminalCopyExtract'
import { registerTerminalSaveExport } from '../utils/terminalSaveExport'
import { createFontRemeasurer } from '../utils/terminalFontRemeasure'
import { observeTerminalResize } from '../utils/terminalResize'
import { installImeInput } from '../utils/imeInput'
import { installTerminalInterruptReset } from '../utils/terminalInterruptReset'
import TerminalViewLinkMenuHost from './TerminalViewLinkMenuHost'
import PastedImageViewerHost from './PastedImageViewerHost'
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

  // The agent currently running in this pane (from OSC title, connection command, or process presence).
  // Decides the image-paste strategy per agent — read at paste time so an agent launched inside
  // an existing shell applies without a remount.
  const resolveCurrentAgent = (fallback: string | null) =>
    fallback ??
    findSessionByTabId(id)?.agent ??
    parseAgentTitle((connection as { localCommand?: string }).localCommand)?.agentName ??
    parseAgentTitle((connection as { command?: string }).command)?.agentName ??
    getPanePresence(id)?.agent ??
    null
  const initialAgent = parseAgentTitle(connection.name)?.agentName ??
    parseAgentTitle(connection.shell)?.agentName ??
    resolveCurrentAgent(null)
  const agentNameRef = useRef<string | null>(initialAgent)
  const currentAgent = () => resolveCurrentAgent(agentNameRef.current)
  const canInsertImagePaths = () => imagePasteModeFor(currentAgent()) === 'insert-path'

  useEffect(() => {
    return onAgentLaunch((sessionId, agent) => {
      if (sessionId === id) agentNameRef.current = latchAgent(agentNameRef.current, agent)
    })
  }, [id])

  // Stable refs so callbacks don't re-trigger the main effect.
  const cbs = useRef({ onStatus, onRestart, onMetrics, onActivity, onTitleChange, onCwdChange, onExit, onFontSizeChange })
  cbs.current = { onStatus, onRestart, onMetrics, onActivity, onTitleChange, onCwdChange, onExit, onFontSizeChange }

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

  // Apply font size and family changes dynamically.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    let changed = false
    if (fontSize && term.options.fontSize !== fontSize) {
      term.options.fontSize = fontSize
      changed = true
    }
    if (fontFamilyMono) {
      const family = resolveTerminalFontFamily(fontFamilyMono)
      if (term.options.fontFamily !== family) {
        term.options.fontFamily = family
        changed = true
      }
    }
    if (changed) requestAnimationFrame(() => safeFitRef.current())
  }, [fontSize, fontFamilyMono])

  useEffect(() => {
    if (!terminalRef.current) return

    const isLocal = connection.type === 'LOCAL'

    const term = new Terminal(createTerminalOptions({
      isLocal, darkMode, fontSize, fontFamilyMono, theme: theme ?? TOKYO_NIGHT.terminal.dark,
    }))
    // xterm's linkHandler is a no-op — `onLinkClick` owns modifier-click activation; `registerPlainUrlLinks` keeps the hover cue (see terminalLinks.ts).
    term.options.linkHandler = { activate: () => {} }

    termRef.current = term

    const api = createSessionChannel(
      isLocal, id, connection.id, connection.shell, darkMode
    )

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    const imeInput = installImeInput(term, window.omnitermAPI.app.platform)
    const titleDisposable = typeof term.onTitleChange === 'function'
      ? term.onTitleChange(title => {
          // Track the running agent for per-agent image paste; LATCHED (see latchAgent) because
          // TUIs rewrite their title with a bare cwd mid-session, killing image paste.
          agentNameRef.current = latchAgent(agentNameRef.current, parseAgentTitle(title)?.agentName ?? null)
          cbs.current.onTitleChange?.(title)
        })
      : { dispose: () => {} }
    const onScrollDisposable = typeof term.onScroll === 'function'
      ? term.onScroll(() => {
          const buf = term.buffer?.active
          if (buf) {
            wasAtBottomRef.current = buf.viewportY == null || buf.baseY == null || buf.viewportY >= buf.baseY - 1
          }
        })
      : { dispose: () => {} }
    const paneDisposables = [
      ...registerCwdReporting(term, (cwd) => cbs.current.onCwdChange?.(cwd)),
      registerPaneScreen(id, term),
      onScrollDisposable,
    ]
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
    const safeFit = (force = false) => {
      const el = terminalRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return

      const pixelSizeChanged = el.clientWidth !== lastClientWidth || el.clientHeight !== lastClientHeight
      lastClientWidth = el.clientWidth
      lastClientHeight = el.clientHeight

      try {
        fitAddon.fit()
        if (activeRef.current) webglController.load()
        if (!force && term.cols === lastCols && term.rows === lastRows) {
          if (pixelSizeChanged) term.refresh(0, term.rows - 1)
          return
        }
        lastCols = term.cols
        lastRows = term.rows
        api.resize({ cols: term.cols, rows: term.rows })
      } catch {
        fitCoalescer.schedule()
      }
    }
    safeFitRef.current = safeFit
    // Coalesces a drag-resize's burst of ResizeObserver callbacks into one settled fit — see coalesce.ts.
    const fitCoalescer = createCoalescer(safeFit, 70)

    term.onData(data => {
      if (interceptPaneInput(id, data)) return // held while an agent probe owns the pane (paneInputHold.ts)
      noteSubmittedInput(id, data, term.buffer) // an agent launch freezes the pane at once (agentLaunchSignal.ts)
      copyTracker.noteInput(data)
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
    const clipboard = createTerminalClipboard(term, () => noteLocalEcho(), canInsertImagePaths, (saved) => recordPastedImage(id, saved), (files) => recordSavedAttachments(id, files), id)
    // Powers the pane-header copy menu's "last output" slice; fed from term.onData below.
    // The wrapper (not `.active`) is handed over so every read resolves the current buffer —
    // xterm's active view can be swapped underneath by resets/replays. The live marker keeps
    // the Enter anchor pinned to its line across scrollback trims and resize reflows; hosts
    // without marker support fall back to a plain index.
    const copyTracker = createLastOutputTracker(
      term.buffer,
      typeof term.registerMarker === 'function' ? () => term.registerMarker(0) : undefined,
    )
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
      canInsertImagePaths,
      onImageSaved: (saved) => recordPastedImage(id, saved),
      onFilesSaved: (files) => recordSavedAttachments(id, files),
      sessionId: id,
    })
    const termEl = terminalRef.current
    termEl.addEventListener('contextmenu', onContextMenu)
    termEl.addEventListener('mousedown', onLinkClick)
    // Alt+Click moves the cursor by emitting the equivalent arrow-key burst — but only when the
    // program has NOT enabled mouse reporting (plain clicks keep native selection either way).
    // See ui/terminal/altClickNavigation.ts for the translation.
    const onAltClickMove = createAltClickMoveHandler(term, api)
    termEl.addEventListener('mousedown', onAltClickMove)
    termEl.addEventListener('paste', onNativePaste, true)
    clipboard.installDrop(termEl) // files dropped on an agent pane become attachments (attachmentInput.ts)
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
    const interruptReset = installTerminalInterruptReset(term, id)
    // The pane-header copy menu (TerminalCopyMenu) asks for this pane's text by session id; the
    // xterm instance lives only here, so the extraction runs at the request site.
    const disposeCopyRequests = registerTerminalCopyHandler({
      sessionId: id,
      isCurrent: () => termRef.current === term,
      extract: (action) =>
        action === 'last-output'
          ? copyTracker.lastOutputText()
          : action === 'all'
            ? bufferText(term.buffer)
            : viewportText(term.buffer, term.rows),
      write: (text) => void writeClipboardText(text),
    })
    const disposeSaveRequests = registerTerminalSaveExport({ sessionId: id, isCurrent: () => termRef.current === term, buffer: term.buffer })

    // WebView zoom and late-loading fonts both invalidate xterm's cached character metrics with
    // no DOM resize event — see utils/terminalFontRemeasure.ts.
    const remeasureCoalescer = createFontRemeasurer(term, safeFit)
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

    // Ctrl+wheel resizes only this pane's font; see ctrlWheelFontResize.ts for the zoom/PTY contract.
    const handleWheel = createCtrlWheelFontResizer(term, safeFit, (size) => cbs.current.onFontSizeChange?.(size))
    termEl.addEventListener('wheel', handleWheel, { passive: false })

    const isMac = window.omnitermAPI.app.platform === 'darwin'

    term.attachCustomKeyEventHandler(
      createTerminalKeyHandler({
        term,
        clipboard,
        connection,
        isMac,
        getAgentName: currentAgent,
        getShortcuts: () => shortcutsRef.current,
        getEnterModes: () => enterModesRef.current,
      }),
    )

    // Status/output/exit and side channels live in terminalStream, not React.
    const stream = attachTerminalStream({
      term, api, id, isLocal, host: connection.host, mode,
      onStatus: (s) => cbs.current.onStatus?.(s),
      onUnavailable: () => setSessionUnavailable(true),
      onExit: (code) => cbs.current.onExit?.(code),
      onMetrics: (m) => cbs.current.onMetrics?.(m),
      onActivity: (busy) => cbs.current.onActivity?.(busy),
      smartColors: () => smartColorsRef.current === true,
      // A fresh PTY/replay needs the real grid resent even when its size is unchanged.
      refit: () => safeFit(true),
      isCurrent: () => termRef.current === term,
    })
    noteLocalEcho = stream.noteLocalEcho

    // Coalesced (not raw safeFit): a drag-resize fires this on every intermediate frame, and
    // fitting/resizing on each one is itself a source of TUI frame corruption.
    const disposeResizeObserver = observeTerminalResize(terminalRef.current, fitCoalescer.schedule)
    // Defer the first fit until after layout so dimensions are valid. Immediate, not coalesced —
    // there's nothing to collapse a burst with yet.
    // Wrapped: rAF passes a timestamp as the first argument, which would read as force=true.
    const raf = requestAnimationFrame(() => safeFit())

    return () => {
      cancelAnimationFrame(raf)
      fitCoalescer.cancel()
      remeasureCoalescer.cancel()
      disposeResizeObserver()
      clipboard.dispose()
      terminalRef.current?.removeEventListener('focusin', onFocusIn)
      terminalRef.current?.removeEventListener('focusout', onFocusOut)
      plainLinkDisposable.dispose()
      titleDisposable.dispose()
      for (const disposable of paneDisposables) disposable.dispose()
      termEl.removeEventListener('contextmenu', onContextMenu)
      termEl.removeEventListener('mousedown', onLinkClick)
      termEl.removeEventListener('mousedown', onAltClickMove)
      termEl.removeEventListener('paste', onNativePaste, true)
      termEl.removeEventListener('mouseup', onMouseUp)
      termEl.removeEventListener('wheel', handleWheel)
      imeInput.dispose()
      window.removeEventListener('omniterm:focus-terminal', onFocusEvent)
      interruptReset.dispose()
      disposeCopyRequests()
      disposeSaveRequests()
      window.removeEventListener('omniterm:zoom-changed', onZoomChanged)
      stream.dispose()
      releaseSessionMedia(id)
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
      if (buffer) wasAtBottomRef.current = buffer.viewportY == null || buffer.baseY == null || buffer.viewportY >= buffer.baseY - 1
      return
    }
    term.focus()
    // The pane the user is looking at must be the last to lose hardware rendering.
    touchRendererRef.current()
    let settleFrame = 0
    if (becameActive || layoutChanged) {
      safeFitRef.current()
      // Layout-count changes can move a pane between grid tracks after React commits. Re-fit once
      // more on the next paint so xterm's canvas/text layers cannot remain sized to the old pane.
      settleFrame = requestAnimationFrame(() => {
        safeFitRef.current()
        if (layoutChanged && wasAtBottomRef.current) {
          term.scrollToBottom?.()
        }
      })
    }
    // Belt and braces for the scroll bug the `.pane-offscreen` rule fixes: even if some future
    // change collapses the pane again, a tab the user left at the live tail comes back to it.
    // xterm queues writes; wait for the queue before restoring a pane that was at the live tail.
    if ((becameActive || layoutChanged) && wasAtBottomRef.current) {
      term.scrollToBottom?.()
      term.write('', () => term.scrollToBottom?.())
    } else if (wasAtBottomRef.current) {
      term.scrollToBottom?.()
    }
    return () => { if (settleFrame) cancelAnimationFrame(settleFrame) }
  }, [active, layoutEpoch])
  return (
    <div
      className="terminal-pane relative h-full w-full"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: theme?.background ?? '#1a1b26',
        padding: 'var(--theme-padding-sm)',
        '--pane-font-mono': resolveTerminalFontFamily(fontFamilyMono),
        filter: blurStrength > 0 && !isFocused && !isHovered ? `blur(${blurStrength}px)` : 'none',
        transition: 'filter 120ms ease-out',
      } as React.CSSProperties}
    >
      <div ref={terminalRef} className="h-full w-full" />
      {sessionUnavailable && cbs.current.onRestart && (
        <SessionUnavailableOverlay onRestart={() => cbs.current.onRestart?.()} />
      )}
      <TerminalViewLinkMenuHost
        menu={linkMenu}
        isLocal={connection.type === 'LOCAL'}
        onClose={() => setLinkMenu(null)}
      />
      <PastedImageViewerHost sessionId={id} />
    </div>
  )
}
export default TerminalView
