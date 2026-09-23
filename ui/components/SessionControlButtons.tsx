import { useEffect, useRef, useState } from 'react'
import { Eraser, ExternalLink, Maximize2, Minimize2, MoreHorizontal, Square } from 'lucide-react'
import type { Connection } from '@omniterm/contract'
import { detachTitle, type DetachAction } from '../detachControl'
import type { AppTheme } from '../themes'
import AppearanceMenu, { FontSizeControl } from './AppearanceMenu'
import TerminalCopyMenu from './TerminalCopyMenu'
import { controlsOverflow } from './sessionControlOverflow'
import { Tooltip, type TooltipPlacement } from './Tooltip'

interface SessionControlButtonsProps {
  conn: Connection
  sessionId: string
  busy?: boolean
  /**
   * Live session gate for the Stop control. The activity probe (`busy`) misreads idle on
   * WSL and fast commands; when provided it alone decides whether Stop is pressable.
   */
  sessionLive?: boolean
  detach: DetachAction | null
  onToggleDetach: () => void
  /** Open a sibling local pane at this session's exact current directory. */
  onOpenCurrentDirectory?: () => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  appearance?: {
    themes: AppTheme[]
    themeId: string
    fontSize: number
    darkMode: boolean
    onThemeApply: (themeId: string) => void
    onFontSizeChange: (delta: number) => void
    scopeLabel?: string
    buttonTitle?: string
  }
  tooltipPlacement?: TooltipPlacement
  detachWhere?: 'pane' | 'footer'
  className?: string
}

const buttonClass = 'w-4 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors'
type ControlKey = 'theme' | 'font' | 'currentDir' | 'stop' | 'clear' | 'copy' | 'detach' | 'fullscreen'
const MORE_BUTTON_WIDTH = 18

export default function SessionControlButtons({
  conn,
  sessionId,
  busy,
  sessionLive,
  detach,
  onToggleDetach,
  onOpenCurrentDirectory,
  fullscreen = false,
  onToggleFullscreen,
  appearance,
  tooltipPlacement = 'bottom',
  detachWhere = 'footer',
  className = '',
}: SessionControlButtonsProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const measurementRef = useRef<HTMLSpanElement>(null)
  const [hiddenControls, setHiddenControls] = useState<ControlKey[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  // The activity probe misreads idle on WSL and fast commands, so Stop must not depend on it:
  // an explicit live flag wins, and legacy callers without one keep the busy fallback.
  const stopEnabled = sessionLive ?? Boolean(busy)

  const sendInput = (data: string) => {
    const api = window.omnitermAPI?.connect
    if (!api) return
    if (conn.type === 'SSH') api.sshInput?.(sessionId, data)
    else if (conn.type === 'LOCAL') api.localInput?.(sessionId, data)
  }

  const stop = (event: React.MouseEvent) => {
    event.stopPropagation()
    const api = window.omnitermAPI?.connect
    if (api) {
      if (conn.type === 'LOCAL') {
        // Native interrupt writes ETX for shell built-ins and immediately terminates descendant
        // foreground processes while deliberately preserving the root shell/PTY.
        const interrupt = api.interruptSession
        if (interrupt) void interrupt(sessionId).catch(() => sendInput('\x03'))
        else sendInput('\x03')
      } else {
        // Remote SSH processes can only be interrupted over their PTY input channel.
        sendInput('\x03')
      }
    }
    // A force-killed (or uncooperative, SIGINT-ignoring) TUI can leave the terminal in a mode it
    // enabled but never got to undo — mouse tracking, bracketed paste, a hidden cursor. The pane
    // itself (TerminalView) owns the fix, since only it can query and write to its xterm instance.
    window.dispatchEvent(new CustomEvent('omniterm:terminal-interrupted', { detail: { id: sessionId } }))
    setMenuOpen(false)
  }

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = () => {
      const availableWidth = root.clientWidth
      const measurement = measurementRef.current
      if (!measurement || !controlsOverflow(availableWidth, measurement.scrollWidth)) {
        setHiddenControls(previous => previous.length === 0 ? previous : [])
        return
      }
      const measured = new Map<ControlKey, number>()
      measurement.querySelectorAll<HTMLElement>('[data-control-key]').forEach(element => {
        measured.set(element.dataset.controlKey as ControlKey, element.offsetWidth || element.scrollWidth)
      })
      const order: ControlKey[] = [
        ...(conn.type === 'LOCAL' && onOpenCurrentDirectory ? ['currentDir'] as ControlKey[] : []),
        ...(conn.type !== 'RDP' ? ['stop', 'clear', 'copy'] as ControlKey[] : []),
        ...(detach ? ['detach'] as ControlKey[] : []),
        ...(appearance ? ['theme', 'font'] as ControlKey[] : []),
        ...(onToggleFullscreen ? ['fullscreen'] as ControlKey[] : []),
      ]
      const hidden: ControlKey[] = []
      let used = 0
      for (const key of order) {
        const width = measured.get(key) ?? 0
        const next = used + (used ? 2 : 0) + width
        if (next + MORE_BUTTON_WIDTH + 2 <= availableWidth) used = next
        else hidden.push(key)
      }
      setHiddenControls(previous => previous.length === hidden.length && previous.every((key, index) => key === hidden[index]) ? previous : hidden)
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(root)
    const slot = root.parentElement
    if (slot && slot !== root) observer.observe(slot)
    return () => observer.disconnect()
  }, [appearance, conn.type, detach, onOpenCurrentDirectory, onToggleFullscreen])

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const clear = (event: React.MouseEvent) => { event.stopPropagation(); sendInput('\x0c'); setMenuOpen(false) }
  const toggleDetach = (event: React.MouseEvent) => { event.stopPropagation(); onToggleDetach(); setMenuOpen(false) }
  const openCurrentDirectory = (event: React.MouseEvent) => { event.stopPropagation(); onOpenCurrentDirectory?.(); setMenuOpen(false) }
  const toggleFullscreen = (event: React.MouseEvent) => { event.stopPropagation(); onToggleFullscreen?.(); setMenuOpen(false) }
  const availableControls: ControlKey[] = [
    ...(conn.type === 'LOCAL' && onOpenCurrentDirectory ? ['currentDir'] as ControlKey[] : []),
    ...(conn.type !== 'RDP' ? ['stop', 'clear', 'copy'] as ControlKey[] : []),
    ...(detach ? ['detach'] as ControlKey[] : []),
    ...(appearance ? ['theme', 'font'] as ControlKey[] : []),
    ...(onToggleFullscreen ? ['fullscreen'] as ControlKey[] : []),
  ]
  const isVisible = (key: ControlKey) => availableControls.includes(key) && !hiddenControls.includes(key)

  const themeControl = appearance && (
    <AppearanceMenu themes={appearance.themes} themeId={appearance.themeId} fontSize={appearance.fontSize}
      darkMode={appearance.darkMode} scopeLabel={appearance.scopeLabel ?? 'this terminal'}
      buttonTitle={appearance.buttonTitle ?? 'Theme and font size'} onThemeApply={appearance.onThemeApply}
      onFontSizeChange={appearance.onFontSizeChange} compact hideFontSize />
  )
  const overflowThemeControl = appearance && (
    <AppearanceMenu themes={appearance.themes} themeId={appearance.themeId} fontSize={appearance.fontSize}
      darkMode={appearance.darkMode} scopeLabel={appearance.scopeLabel ?? 'this terminal'}
      onThemeApply={appearance.onThemeApply} onFontSizeChange={appearance.onFontSizeChange}
      compact hideFontSize menuItem />
  )
  const fontControl = appearance && <FontSizeControl fontSize={appearance.fontSize}
    scopeLabel={appearance.scopeLabel ?? 'this terminal'} onFontSizeChange={appearance.onFontSizeChange} compact />
  const currentDirectoryControl = conn.type === 'LOCAL' && onOpenCurrentDirectory && (
    <Tooltip content="Open new pane with current directory" shortcut="Ctrl+Shift+N" placement={tooltipPlacement}>
      <button
        type="button"
        onClick={openCurrentDirectory}
        className="w-5 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors"
        aria-label="Open new pane with current directory"
      >
        <svg viewBox="0 0 25 25" fill="none" className="w-5 h-5" aria-hidden="true">
          <path d="M8.5 9.5L11.5 12.5L8.5 15.5M13 15.5H17M5.5 6.5H19.5V18.5H5.5V6.5Z" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </Tooltip>
  )
  const stopControl = (
    <Tooltip content="Stop current process" placement={tooltipPlacement}>
      <button type="button" disabled={!stopEnabled} onClick={stop}
        className={`${buttonClass} hover:bg-theme-error/20 hover:text-theme-error disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-theme-dim`} aria-label="Stop current process">
        <Square className="w-3 h-3" />
      </button>
    </Tooltip>
  )
  const clearControl = (
    <Tooltip content="Clear terminal (Ctrl+L)" placement={tooltipPlacement}>
      <button type="button" onClick={clear} className={buttonClass} aria-label="Clear terminal"><Eraser className="w-3 h-3" /></button>
    </Tooltip>
  )
  const detachControl = detach && (
    <Tooltip content={detachTitle(detach, detachWhere)} placement={tooltipPlacement}>
      <button type="button" onClick={toggleDetach} className={buttonClass} aria-label={detachTitle(detach, detachWhere)}>
        {detach === 'attach' ? <Minimize2 className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
      </button>
    </Tooltip>
  )
  const fullscreenControl = onToggleFullscreen && (
    <Tooltip content={fullscreen ? 'Restore view mode' : 'Focus pane full screen'} placement={tooltipPlacement}>
      <button type="button" onClick={toggleFullscreen} className={buttonClass} aria-label={fullscreen ? 'Restore view mode' : 'Focus pane full screen'}>
        {fullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
      </button>
    </Tooltip>
  )
  const menuItemClass = 'flex w-full items-center gap-2 rounded-md bg-theme-popup px-2 py-1.5 text-left text-xs text-theme-fg hover:bg-theme-hover disabled:opacity-40'

  return (
    <span ref={rootRef} data-testid="session-control-root" data-session-control-root className={`relative flex min-w-[18px] flex-1 items-center justify-end gap-0.5 ${className}`}>
      <span ref={measurementRef} aria-hidden="true" className="terminal-control-measurement absolute left-0 top-0 inline-flex items-center gap-0.5 whitespace-nowrap invisible pointer-events-none">
        {conn.type === 'LOCAL' && onOpenCurrentDirectory && <span data-control-key="currentDir" className="h-4 w-5" />}
        {conn.type !== 'RDP' && <><span data-control-key="stop" className={buttonClass} /><span data-control-key="clear" className={buttonClass} /><span data-control-key="copy" className={buttonClass} /></>}
        {detach && <span data-control-key="detach" className={buttonClass} />}
        {appearance && <><span data-control-key="theme" className="h-4 w-4" /><span data-control-key="font" className="h-4 w-[3.75rem]" /></>}
        {onToggleFullscreen && <span data-control-key="fullscreen" className={buttonClass} />}
      </span>
      {isVisible('currentDir') && currentDirectoryControl}
      {isVisible('stop') && stopControl}
      {isVisible('clear') && clearControl}
      {isVisible('copy') && conn.type !== 'RDP' && <TerminalCopyMenu sessionId={sessionId} placement={tooltipPlacement === 'top' ? 'top' : 'bottom'} />}
      {isVisible('detach') && detachControl}
      {isVisible('theme') && themeControl}
      {isVisible('font') && fontControl}
      {isVisible('fullscreen') && fullscreenControl}
      {hiddenControls.length > 0 && (
        <>
          <Tooltip content="More terminal actions" placement={tooltipPlacement}>
            <button type="button" onClick={(event) => { event.stopPropagation(); setMenuOpen(open => !open) }} className={buttonClass} aria-label="More terminal actions" aria-haspopup="menu" aria-expanded={menuOpen}>
              <MoreHorizontal className="w-3 h-3" />
            </button>
          </Tooltip>
          {menuOpen && (
            <div role="menu" aria-label="More terminal actions" className={`absolute right-0 z-50 min-w-48 rounded-lg border border-theme-border bg-theme-popup p-1 shadow-xl ${tooltipPlacement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
              {hiddenControls.includes('currentDir') && (
                <button type="button" role="menuitem" onClick={openCurrentDirectory} className={menuItemClass}>
                  <svg viewBox="0 0 25 25" fill="none" className="h-4 w-4 flex-shrink-0" aria-hidden="true">
                    <path d="M8.5 9.5L11.5 12.5L8.5 15.5M13 15.5H17M5.5 6.5H19.5V18.5H5.5V6.5Z" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                  Open new pane with current directory
                </button>
              )}
              {hiddenControls.includes('stop') && <button type="button" role="menuitem" disabled={!stopEnabled} onClick={stop} className={menuItemClass}><Square className="h-3.5 w-3.5 flex-shrink-0" />Stop current process</button>}
              {hiddenControls.includes('clear') && <button type="button" role="menuitem" onClick={clear} className={menuItemClass}><Eraser className="h-3.5 w-3.5 flex-shrink-0" />Clear terminal</button>}
              {hiddenControls.includes('copy') && conn.type !== 'RDP' && <TerminalCopyMenu sessionId={sessionId} menuItem />}
              {hiddenControls.includes('detach') && <button type="button" role="menuitem" onClick={toggleDetach} className={menuItemClass}>{detach === 'attach' ? <Minimize2 className="h-3.5 w-3.5 flex-shrink-0" /> : <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />}{detachTitle(detach!, detachWhere)}</button>}
              {hiddenControls.includes('theme') && overflowThemeControl}
              {hiddenControls.includes('fullscreen') && <button type="button" role="menuitem" onClick={toggleFullscreen} className={menuItemClass}>{fullscreen ? <Minimize2 className="h-3.5 w-3.5 flex-shrink-0" /> : <Maximize2 className="h-3.5 w-3.5 flex-shrink-0" />}{fullscreen ? 'Restore view mode' : 'Focus pane full screen'}</button>}
              {hiddenControls.includes('font') && appearance && <div className="mt-1 border-t border-theme-border pt-1"><FontSizeControl fontSize={appearance.fontSize} scopeLabel={appearance.scopeLabel ?? 'this terminal'} onFontSizeChange={appearance.onFontSizeChange} compact fullWidth /></div>}
            </div>
          )}
        </>
      )}
    </span>
  )
}
