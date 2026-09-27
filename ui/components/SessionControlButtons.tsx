import { useEffect, useRef, useState } from 'react'
import { Eraser, ExternalLink, Maximize2, Minimize2, MoreHorizontal, Save, Settings2, Square } from 'lucide-react'
import type { Connection } from '@omniterm/contract'
import { detachTitle, type DetachAction } from '../detachControl'
import type { AppTheme } from '../themes'
import { toolbarActionsFor, type TerminalToolbarAction, type TerminalToolbarActions } from '../terminalToolbar'
import AppearanceMenu, { FontSizeControl } from './AppearanceMenu'
import TerminalActionsCustomize from './TerminalActionsCustomize'
import TerminalCopyMenu from './TerminalCopyMenu'
import { controlsOverflow } from './sessionControlOverflow'
import { Tooltip, type TooltipPlacement } from './Tooltip'

export type TerminalControlSurface = 'header' | 'footer'

export interface SessionControlAppearance {
  themes?: AppTheme[]
  themeId?: string
  fontSize?: number
  darkMode?: boolean
  onThemeApply?: (themeId: string) => void
  onFontSizeChange?: (delta: number) => void
  headerActions?: readonly TerminalToolbarAction[]
  footerActions?: readonly TerminalToolbarAction[]
  onToolbarActionsChange?: (actions: TerminalToolbarActions) => void
  scopeLabel?: string
  buttonTitle?: string
}

interface SessionControlButtonsProps {
  conn: Connection
  sessionId: string
  busy?: boolean
  sessionLive?: boolean
  detach: DetachAction | null
  onToggleDetach: () => void
  onOpenCurrentDirectory?: () => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  appearance?: SessionControlAppearance
  onSaveOutput?: () => void
  surface?: TerminalControlSurface
  tooltipPlacement?: TooltipPlacement
  detachWhere?: 'pane' | 'footer'
  className?: string
}

type ControlKey = 'currentDir' | 'stop' | 'clear' | 'copy' | 'save' | 'detach' | 'fullscreen' | 'theme' | 'font'

const MORE_BUTTON_WIDTH = 18
const buttonClass = 'w-4 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors'
const actionToControl: Record<TerminalToolbarAction, ControlKey> = {
  theme: 'theme',
  detach: 'detach',
  fullscreen: 'fullscreen',
  fontSize: 'font',
  stop: 'stop',
  clear: 'clear',
  copy: 'copy',
  save: 'save',
}

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
  onSaveOutput,
  surface,
  tooltipPlacement = 'bottom',
  detachWhere = 'footer',
  className = '',
}: SessionControlButtonsProps) {
  const resolvedSurface = surface ?? 'legacy'
  const rootRef = useRef<HTMLSpanElement>(null)
  const measurementRef = useRef<HTMLSpanElement>(null)
  const [hiddenControls, setHiddenControls] = useState<ControlKey[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const stopEnabled = sessionLive ?? Boolean(busy)

  // Every layout has a footer carrying the footer actions, so the header shows only its own set;
  // mirroring stop/clear/copy/save into the header duplicated them in split layouts.
  const headerActionList = toolbarActionsFor({
    header: appearance?.headerActions ? [...appearance.headerActions] : undefined,
  }, 'header')
  const footerActionList = toolbarActionsFor({
    footer: appearance?.footerActions ? [...appearance.footerActions] : undefined,
  }, 'footer')

  const selectedActions: TerminalToolbarAction[] = resolvedSurface === 'legacy'
    ? ['theme', 'detach', 'fullscreen', 'fontSize', 'stop', 'clear', 'copy', 'save']
    : resolvedSurface === 'header' ? headerActionList : footerActionList

  const supportedHeaderActions: TerminalToolbarAction[] = [
    ...(appearance?.themes && appearance.onThemeApply ? ['theme' as const] : []),
    ...(detach ? ['detach' as const] : []),
    ...(onToggleFullscreen ? ['fullscreen' as const] : []),
  ]
  const supportedFooterActions: TerminalToolbarAction[] = [
    ...(appearance?.fontSize !== undefined && appearance.onFontSizeChange ? ['fontSize' as const] : []),
    ...(conn.type !== 'RDP' ? ['stop', 'clear', 'copy', 'save'] as const : []),
  ]
  const supportedLegacyActions: TerminalToolbarAction[] = [
    ...(appearance?.themes && appearance.onThemeApply ? ['theme' as const] : []),
    ...(appearance?.fontSize !== undefined && appearance.onFontSizeChange ? ['fontSize' as const] : []),
    ...(detach ? ['detach' as const] : []),
    ...(onToggleFullscreen ? ['fullscreen' as const] : []),
    ...(conn.type !== 'RDP' ? ['stop', 'clear', 'copy', 'save'] as const : []),
  ]
  const supportedActions = resolvedSurface === 'header'
    ? supportedHeaderActions
    : resolvedSurface === 'footer' ? supportedFooterActions : supportedLegacyActions
  const availableControls = selectedActions
    .filter(action => supportedActions.includes(action))
    .map(action => actionToControl[action])
  if (resolvedSurface === 'legacy' && onOpenCurrentDirectory) availableControls.push('currentDir')
  const overflowOnlyControls: ControlKey[] = resolvedSurface === 'header' && onOpenCurrentDirectory ? ['currentDir'] : []

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
        const interrupt = api.interruptSession
        if (interrupt) void interrupt(sessionId).catch(() => sendInput('\x03'))
        else sendInput('\x03')
      } else {
        sendInput('\x03')
      }
    }
    window.dispatchEvent(new CustomEvent('omniterm:terminal-interrupted', { detail: { id: sessionId } }))
    setMenuOpen(false)
  }

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = () => {
      const availableWidth = root.clientWidth
      const measurement = measurementRef.current
      if (!measurement) {
        setHiddenControls(previous => previous.length === 0 ? previous : [])
        return
      }
      if (!availableWidth) {
        setHiddenControls(typeof ResizeObserver === 'undefined' ? [] : availableControls)
        return
      }
      if (!controlsOverflow(availableWidth, measurement.scrollWidth)) {
        setHiddenControls(previous => previous.length === 0 ? previous : [])
        return
      }
      const measured = new Map<ControlKey, number>()
      measurement.querySelectorAll<HTMLElement>('[data-control-key]').forEach(element => {
        measured.set(element.dataset.controlKey as ControlKey, element.offsetWidth || element.scrollWidth)
      })
      const hidden: ControlKey[] = []
      let used = 0
      for (const key of availableControls) {
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
  }, [availableControls.join('|'), resolvedSurface])

  useEffect(() => {
    if (!menuOpen && !customizeOpen) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
        setCustomizeOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        setCustomizeOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [customizeOpen, menuOpen])

  const clear = (event: React.MouseEvent) => { event.stopPropagation(); sendInput('\x0c'); setMenuOpen(false) }
  const toggleDetach = (event: React.MouseEvent) => { event.stopPropagation(); onToggleDetach(); setMenuOpen(false) }
  const openCurrentDirectory = (event: React.MouseEvent) => { event.stopPropagation(); onOpenCurrentDirectory?.(); setMenuOpen(false) }
  const toggleFullscreen = (event: React.MouseEvent) => { event.stopPropagation(); onToggleFullscreen?.(); setMenuOpen(false) }
  const themeControl = appearance?.themes && appearance.onThemeApply && (
    <AppearanceMenu
      themes={appearance.themes}
      themeId={appearance.themeId ?? ''}
      fontSize={appearance.fontSize ?? 14}
      darkMode={appearance.darkMode ?? true}
      scopeLabel={appearance.scopeLabel ?? 'this terminal'}
      buttonTitle={appearance.buttonTitle ?? 'Theme for this terminal'}
      onThemeApply={appearance.onThemeApply}
      onFontSizeChange={appearance.onFontSizeChange ?? (() => {})}
      compact
      hideFontSize
    />
  )
  const fontControl = appearance?.fontSize !== undefined && appearance.onFontSizeChange && (
    <FontSizeControl
      fontSize={appearance.fontSize}
      scopeLabel={appearance.scopeLabel ?? 'this terminal'}
      onFontSizeChange={appearance.onFontSizeChange}
      compact
    />
  )
  const currentDirectoryControl = onOpenCurrentDirectory && (
    <Tooltip content="Open new pane with current directory" shortcut="Ctrl+Shift+N" placement={tooltipPlacement}>
      <button type="button" onClick={openCurrentDirectory} className="w-5 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors" aria-label="Open new pane with current directory">
        <svg viewBox="0 0 25 25" fill="none" className="w-5 h-5" aria-hidden="true">
          <path d="M8.5 9.5L11.5 12.5L8.5 15.5M13 15.5H17M5.5 6.5H19.5V18.5H5.5V6.5Z" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </Tooltip>
  )
  const stopControl = (
    <Tooltip content="Stop current process" placement={tooltipPlacement}>
      <button type="button" disabled={!stopEnabled} onClick={stop} className={`${buttonClass} hover:bg-theme-error/20 hover:text-theme-error disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-theme-dim`} aria-label="Stop current process">
        <Square className="w-3 h-3" />
      </button>
    </Tooltip>
  )
  const clearControl = (
    <Tooltip content="Clear terminal (Ctrl+L)" placement={tooltipPlacement}>
      <button type="button" onClick={clear} className={buttonClass} aria-label="Clear terminal"><Eraser className="w-3 h-3" /></button>
    </Tooltip>
  )
  const saveControl = (
    <Tooltip content="Save terminal output to file" placement={tooltipPlacement}>
      <button type="button" onClick={(event) => { event.stopPropagation(); onSaveOutput?.() }} className={buttonClass} aria-label="Save terminal output to file">
        <Save className="w-3 h-3" />
      </button>
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
  const menuControls = [...hiddenControls, ...overflowOnlyControls.filter(key => !hiddenControls.includes(key))]
  const menuItemClass = 'flex w-full items-center gap-2 rounded-md bg-theme-popup px-2 py-1.5 text-left text-xs text-theme-fg hover:bg-theme-hover disabled:opacity-40'
  const headerActions = toolbarActionsFor({ header: appearance?.headerActions ? [...appearance.headerActions] : undefined }, 'header')
  const footerActions = toolbarActionsFor({ footer: appearance?.footerActions ? [...appearance.footerActions] : undefined }, 'footer')

  return (
    <span ref={rootRef} data-testid="session-control-root" data-session-control-root className={`relative flex min-w-[18px] flex-1 items-center justify-end gap-0.5 ${className}`}>
      <span ref={measurementRef} aria-hidden="true" className="terminal-control-measurement absolute left-0 top-0 inline-flex items-center gap-0.5 whitespace-nowrap invisible pointer-events-none">
        {availableControls.map(key => <span key={key} data-control-key={key} className={key === 'font' ? 'h-4 w-[3.75rem]' : buttonClass} />)}
      </span>
      {availableControls.includes('currentDir') && !hiddenControls.includes('currentDir') && currentDirectoryControl}
      {availableControls.includes('theme') && !hiddenControls.includes('theme') && themeControl}
      {availableControls.includes('detach') && !hiddenControls.includes('detach') && detachControl}
      {availableControls.includes('fullscreen') && !hiddenControls.includes('fullscreen') && fullscreenControl}
      {availableControls.includes('font') && !hiddenControls.includes('font') && fontControl}
      {availableControls.includes('stop') && !hiddenControls.includes('stop') && stopControl}
      {availableControls.includes('clear') && !hiddenControls.includes('clear') && clearControl}
      {availableControls.includes('copy') && !hiddenControls.includes('copy') && <TerminalCopyMenu sessionId={sessionId} placement={tooltipPlacement === 'top' ? 'top' : 'bottom'} />}
      {availableControls.includes('save') && !hiddenControls.includes('save') && saveControl}
      {appearance?.onToolbarActionsChange && resolvedSurface === 'footer' && (
        <Tooltip content="Customize terminal actions" placement={tooltipPlacement}>
          <button type="button" onClick={(event) => { event.stopPropagation(); setCustomizeOpen(open => !open); setMenuOpen(false) }} className={buttonClass} aria-label="Customize terminal actions" aria-haspopup="dialog" aria-expanded={customizeOpen}>
            <Settings2 className="w-3 h-3" />
          </button>
        </Tooltip>
      )}
      {menuControls.length > 0 && (
        <>
          <Tooltip content="More terminal actions" placement={tooltipPlacement}>
            <button type="button" onClick={(event) => { event.stopPropagation(); setMenuOpen(open => !open); setCustomizeOpen(false) }} className={buttonClass} aria-label="More terminal actions" aria-haspopup="menu" aria-expanded={menuOpen}>
              <MoreHorizontal className="w-3 h-3" />
            </button>
          </Tooltip>
          {menuOpen && (
            <div role="menu" aria-label="More terminal actions" className={`absolute right-0 z-50 min-w-48 rounded-lg border border-theme-border bg-theme-popup p-1 shadow-xl ${tooltipPlacement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
              {menuControls.includes('currentDir') && <button type="button" role="menuitem" onClick={openCurrentDirectory} className={menuItemClass}>
                <svg viewBox="0 0 25 25" fill="none" className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true">
                  <path d="M8.5 9.5L11.5 12.5L8.5 15.5M13 15.5H17M5.5 6.5H19.5V18.5H5.5V6.5Z" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                <span>Open new pane with current directory</span>
              </button>}
              {menuControls.includes('theme') && <div role="menuitem" aria-label="Theme" className="flex items-center gap-2 px-2 py-1" onClick={(event) => {
                if (event.target === event.currentTarget) event.currentTarget.querySelector('button')?.click()
              }}><span>Theme</span>{themeControl}</div>}
              {menuControls.includes('font') && <div role="menuitem" aria-label="Font size" className="flex items-center gap-2 px-2 py-1"><span>Font size</span>{fontControl}</div>}
              {menuControls.includes('stop') && <button type="button" role="menuitem" disabled={!stopEnabled} onClick={stop} className={menuItemClass}><Square className="h-3.5 w-3.5 flex-shrink-0" />Stop current process</button>}
              {menuControls.includes('clear') && <button type="button" role="menuitem" onClick={clear} className={menuItemClass}><Eraser className="h-3.5 w-3.5 flex-shrink-0" />Clear terminal</button>}
              {menuControls.includes('copy') && <TerminalCopyMenu sessionId={sessionId} menuItem />}
              {menuControls.includes('save') && <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); onSaveOutput?.(); setMenuOpen(false) }} className={menuItemClass}><Save className="h-3.5 w-3.5 flex-shrink-0" />Save terminal output</button>}
              {menuControls.includes('detach') && <button type="button" role="menuitem" onClick={toggleDetach} className={menuItemClass}>{detach === 'attach' ? <Minimize2 className="h-3.5 w-3.5 flex-shrink-0" /> : <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />}{detachTitle(detach!, detachWhere)}</button>}
              {menuControls.includes('fullscreen') && <button type="button" role="menuitem" onClick={toggleFullscreen} className={menuItemClass}>{fullscreen ? <Minimize2 className="h-3.5 w-3.5 flex-shrink-0" /> : <Maximize2 className="h-3.5 w-3.5 flex-shrink-0" />}{fullscreen ? 'Restore view mode' : 'Focus pane full screen'}</button>}
            </div>
          )}
        </>
      )}
      {customizeOpen && appearance?.onToolbarActionsChange && resolvedSurface === 'footer' && (
        <TerminalActionsCustomize
          headerActions={headerActions}
          footerActions={footerActions}
          availableHeaderActions={supportedHeaderActions}
          availableFooterActions={supportedFooterActions}
          onChange={appearance.onToolbarActionsChange}
          onClose={() => setCustomizeOpen(false)}
          placement={tooltipPlacement === 'top' ? 'top' : 'bottom'}
        />
      )}
    </span>
  )
}
