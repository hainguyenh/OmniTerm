import { useEffect, useRef, useState } from 'react'
import { Eraser, ExternalLink, Maximize2, Minimize2, MoreHorizontal, Square } from 'lucide-react'
import type { Connection } from '@omniterm/contract'
import { detachTitle, type DetachAction } from '../detachControl'
import type { AppTheme } from '../themes'
import AppearanceMenu, { FontSizeControl } from './AppearanceMenu'
import SessionPersistenceMenu from './SessionPersistenceMenu'
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
  /** Invoked when the escalated Force kill fails, so hosts can surface a notifier. */
  onForceKillError?: (error: unknown) => void
  detach: DetachAction | null
  onToggleDetach: () => void
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
type ControlKey = 'theme' | 'font' | 'stop' | 'clear' | 'copy' | 'persistence' | 'detach' | 'fullscreen'
const MORE_BUTTON_WIDTH = 18
/** Delay before a SIGINT-only Stop press arms the Force kill escalation. */
const STOP_ESCALATION_MS = 3000

export default function SessionControlButtons({
  conn,
  sessionId,
  busy,
  sessionLive,
  onForceKillError,
  detach,
  onToggleDetach,
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
  const [escalated, setEscalated] = useState(false)
  const escalationTimerRef = useRef<number | null>(null)

  // The activity probe misreads idle on WSL and fast commands, so Stop must not depend on it:
  // an explicit live flag wins, and legacy callers without one keep the busy fallback.
  const stopEnabled = sessionLive ?? Boolean(busy)

  const clearEscalationTimer = () => {
    if (escalationTimerRef.current != null) {
      window.clearTimeout(escalationTimerRef.current)
      escalationTimerRef.current = null
    }
  }

  useEffect(() => {
    clearEscalationTimer()
    setEscalated(false)
    return clearEscalationTimer
  }, [sessionId])

  // Escalation is armed for ONE process only. Without this reset, a red (Force kill) button
  // survives the process it was aimed at and turns a later process's first Stop press into an
  // instant session teardown instead of a Ctrl+C.
  useEffect(() => {
    clearEscalationTimer()
    setEscalated(false)
  }, [busy, sessionLive])

  const sendInput = (data: string) => {
    const api = window.omnitermAPI?.connect
    if (!api) return
    if (conn.type === 'SSH') api.sshInput?.(sessionId, data)
    else if (conn.type === 'LOCAL') api.localInput?.(sessionId, data)
  }

  const stop = (event: React.MouseEvent) => {
    event.stopPropagation()
    const api = window.omnitermAPI?.connect
    if (!api) return
    if (escalated) {
      // Second press: the process ignored CTRL_C_EVENT, so tear the daemon session down.
      // The session-death status stream then drives the standard restart overlay.
      clearEscalationTimer()
      api.forceKillSession?.(sessionId).catch((error: unknown) => onForceKillError?.(error))
      setMenuOpen(false)
      return
    }
    sendInput('\x03')
    clearEscalationTimer()
    escalationTimerRef.current = window.setTimeout(() => {
      escalationTimerRef.current = null
      setEscalated(true)
    }, STOP_ESCALATION_MS)
    setMenuOpen(false)
  }

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = () => {
      const availableWidth = root.clientWidth
      const measurement = measurementRef.current
      if (!availableWidth || !measurement || !controlsOverflow(availableWidth, measurement.scrollWidth)) {
        setHiddenControls(previous => previous.length === 0 ? previous : [])
        return
      }
      const measured = new Map<ControlKey, number>()
      measurement.querySelectorAll<HTMLElement>('[data-control-key]').forEach(element => {
        measured.set(element.dataset.controlKey as ControlKey, element.offsetWidth || element.scrollWidth)
      })
      const order: ControlKey[] = [
        ...(appearance ? ['theme', 'font'] as ControlKey[] : []),
        ...(conn.type !== 'RDP' ? ['stop', 'clear', 'copy', 'persistence'] as ControlKey[] : []),
        ...(detach ? ['detach'] as ControlKey[] : []),
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
  }, [appearance, conn.type, detach, onToggleFullscreen])

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
  const toggleFullscreen = (event: React.MouseEvent) => { event.stopPropagation(); onToggleFullscreen?.(); setMenuOpen(false) }
  const availableControls: ControlKey[] = [
    ...(appearance ? ['theme', 'font'] as ControlKey[] : []),
    ...(conn.type !== 'RDP' ? ['stop', 'clear', 'copy', 'persistence'] as ControlKey[] : []),
    ...(detach ? ['detach'] as ControlKey[] : []),
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
  const stopControl = escalated ? (
    <Tooltip content="Force kill session (process ignored Ctrl+C)" placement={tooltipPlacement}>
      <button type="button" onClick={stop}
        className={`${buttonClass} bg-theme-error/20 text-theme-error hover:bg-theme-error/30 hover:text-theme-error`} aria-label="Force kill session">
        <Square className="w-3 h-3 fill-current" />
      </button>
    </Tooltip>
  ) : (
    <Tooltip content="Stop current process (Ctrl+C)" placement={tooltipPlacement}>
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
    <span ref={rootRef} data-testid="session-control-root" data-session-control-root className={`relative flex min-w-0 flex-1 items-center justify-end gap-0.5 ${className}`}>
      <span ref={measurementRef} aria-hidden="true" className="terminal-control-measurement absolute left-0 top-0 inline-flex items-center gap-0.5 whitespace-nowrap invisible pointer-events-none">
        {appearance && <><span data-control-key="theme" className="h-4 w-4" /><span data-control-key="font" className="h-4 w-[3.75rem]" /></>}
        {conn.type !== 'RDP' && <><span data-control-key="stop" className={buttonClass} /><span data-control-key="clear" className={buttonClass} /><span data-control-key="copy" className={buttonClass} /><span data-control-key="persistence" className={buttonClass} /></>}
        {detach && <span data-control-key="detach" className={buttonClass} />}
        {onToggleFullscreen && <span data-control-key="fullscreen" className={buttonClass} />}
      </span>
      {isVisible('theme') && themeControl}
      {isVisible('font') && fontControl}
      {isVisible('stop') && stopControl}
      {isVisible('clear') && clearControl}
      {isVisible('copy') && conn.type !== 'RDP' && <TerminalCopyMenu sessionId={sessionId} placement={tooltipPlacement === 'top' ? 'top' : 'bottom'} />}
      {isVisible('persistence') && conn.type !== 'RDP' && <SessionPersistenceMenu sessionId={sessionId} placement={tooltipPlacement === 'top' ? 'top' : 'bottom'} />}
      {isVisible('detach') && detachControl}
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
              {hiddenControls.includes('theme') && overflowThemeControl}
              {hiddenControls.includes('stop') && <button type="button" role="menuitem" disabled={!stopEnabled} onClick={stop} className={menuItemClass}><Square className="h-3.5 w-3.5 flex-shrink-0" />{escalated ? 'Force kill session' : 'Stop current process'}</button>}
              {hiddenControls.includes('clear') && <button type="button" role="menuitem" onClick={clear} className={menuItemClass}><Eraser className="h-3.5 w-3.5 flex-shrink-0" />Clear terminal</button>}
              {hiddenControls.includes('persistence') && <SessionPersistenceMenu sessionId={sessionId} placement="bottom" menuItem />}
              {hiddenControls.includes('copy') && conn.type !== 'RDP' && <TerminalCopyMenu sessionId={sessionId} menuItem />}
              {hiddenControls.includes('detach') && <button type="button" role="menuitem" onClick={toggleDetach} className={menuItemClass}>{detach === 'attach' ? <Minimize2 className="h-3.5 w-3.5 flex-shrink-0" /> : <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />}{detachTitle(detach!, detachWhere)}</button>}
              {hiddenControls.includes('fullscreen') && <button type="button" role="menuitem" onClick={toggleFullscreen} className={menuItemClass}>{fullscreen ? <Minimize2 className="h-3.5 w-3.5 flex-shrink-0" /> : <Maximize2 className="h-3.5 w-3.5 flex-shrink-0" />}{fullscreen ? 'Restore view mode' : 'Focus pane full screen'}</button>}
              {hiddenControls.includes('font') && appearance && <div className="mt-1 border-t border-theme-border pt-1"><FontSizeControl fontSize={appearance.fontSize} scopeLabel={appearance.scopeLabel ?? 'this terminal'} onFontSizeChange={appearance.onFontSizeChange} compact fullWidth /></div>}
            </div>
          )}
        </>
      )}
    </span>
  )
}
