import React from 'react'
import { createPortal } from 'react-dom'
import { Terminal, Monitor, ChevronDown, Check, X, RotateCw } from 'lucide-react'
import type { Connection, SessionStatus } from '@omniterm/contract'
import { paneIdentity, paneSurfaceColor, withAlpha } from '../paneIdentity'
import type { DetachAction } from '../detachControl'
import type { SessionTabItem } from './SessionTabs'
import type { AppTheme } from '../themes'
import type { TerminalToolbarAction, TerminalToolbarActions } from '../terminalToolbar'
import { formatTerminalTitle } from '../utils/agentTitle'
import { requestRenewFromPane } from '../hooks/useRenewSession'
import SessionStatusIndicator from './SessionStatusIndicator'
import SessionControlButtons from './SessionControlButtons'
import { PaneHeaderTitle } from './PaneHeaderTitle'
import { Tooltip } from './Tooltip'

/**
 * The mini header on top of every terminal: the pane's identity (shape + number in its own hue — see
 * paneIdentity.ts), the session it holds, a drag handle for rearranging panes, and a chevron opening
 * the picker that fills/re-assigns the pane. In single view (`single`) there is nothing to arrange,
 * so the pane identity, drag handle and picker are left out and only the session's own row remains.
 *
 * The identity hue is what ties a pane to its tabs in the strip above; focus is carried by brightness
 * and by a filled (vs outlined) shape, so the two signals never compete for the same colour.
 */
interface PaneHeaderProps {
  paneIndex: number
  /** Null while the pane is empty. */
  conn: Connection | null
  sessionTitle?: string
  /** Live shell working directory label (OSC 7 / OSC 9;9), alias-resolved. Overrides title folder. */
  liveFolder?: string
  /** Human-readable shell label, e.g. "PowerShell 7" — shown in agent mode. */
  shellLabel?: string
  /** The live local directory represented by the folder label. */
  folderPath?: string
  onOpenFolder?: () => void
  focused: boolean
  sessionId: string | null
  tabs: SessionTabItem[]
  panes: (string | null)[]
  layoutMode: number
  statuses: Record<string, SessionStatus>
  connType: (connId: string) => Connection['type'] | undefined
  pickerOpen: boolean
  /** Shared with MainLayout's outside-click handler, which closes whichever picker is open. */
  pickerRef: React.RefObject<HTMLDivElement>
  pickerAnchor?: DOMRect | null
  /**
   * Direction of this pane's detach/attach button, or null to omit it (see detachControl.ts). Every
   * dock carries its own copy so a session can be popped out or folded back without first being made
   * the active tab — the footer button only ever acts on whichever tab that is.
   */
  detach: DetachAction | null
  onToggleDetach: () => void
  onFocus: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onTogglePicker: (anchor: DOMRect) => void
  onAssign: (tabId: string) => void
  onClear: () => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  /** Close this pane's session tab, using the main layout's normal confirmation policy. */
  onClose?: () => void
  /** Open another local terminal pane at this pane's exact live working directory. */
  onOpenCurrentDirectory?: () => void
  busy?: boolean
  /** Single view: one terminal fills the window, so pane arrangement controls are hidden. */
  single?: boolean
  /** This pane's effective look, and the palette to change it — omitted while the pane is empty. */
  appearance?: {
    themes: AppTheme[]
    themeId: string
    fontSize: number
    darkMode: boolean
    onThemeApply: (themeId: string) => void
    onFontSizeChange: (delta: number) => void
    headerActions?: readonly TerminalToolbarAction[]
    footerActions?: readonly TerminalToolbarAction[]
    onToolbarActionsChange?: (actions: TerminalToolbarActions) => void
    scopeLabel?: string
    buttonTitle?: string
  }
}

const PaneHeader: React.FC<PaneHeaderProps> = ({
  paneIndex, conn, sessionTitle, liveFolder, shellLabel, folderPath, onOpenFolder, focused, sessionId, tabs, panes, layoutMode, statuses, connType,
  pickerOpen, pickerRef, pickerAnchor, detach, onToggleDetach, onFocus, onDragStart, onDragEnd, onTogglePicker,
  onAssign, onClear, onClose, onOpenCurrentDirectory, fullscreen, onToggleFullscreen, appearance, busy, single = false,
}) => {
  const identity = paneIdentity(paneIndex)
  const Shape = identity.icon
  const hue = focused ? identity.color : withAlpha(identity.color, 0.55)
  const pickerMaxHeight = Math.min(260, Math.max(80, window.innerHeight - 16))
  const pickerBelowTop = pickerAnchor ? pickerAnchor.bottom + 4 : 0
  const pickerOpensAbove = pickerAnchor
    ? pickerBelowTop <= window.innerHeight - pickerMaxHeight - 8
      ? false
      : true
    : false
  const arrangeable = !!conn && !single

  return (
    <div className="relative flex-shrink-0" data-pane-header>
      <div
        draggable={arrangeable}
        onDragStart={arrangeable ? (e) => {
          e.dataTransfer.setData('text/plain', String(paneIndex))
          e.dataTransfer.effectAllowed = 'move'
          onDragStart()
        } : undefined}
        onDragEnd={onDragEnd}
        onMouseDown={onFocus}
        className={`h-6 flex items-center gap-1.5 px-2 text-[11px] select-none ${arrangeable ? 'cursor-grab active:cursor-grabbing' : ''} ${
          focused ? 'bg-theme-bg text-theme-fg' : 'bg-theme-sidebar text-theme-dim'
        }`}
        style={conn && !single ? { backgroundColor: paneSurfaceColor(identity, focused) } : undefined}
      >
        {!single && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Shape className="w-3.5 h-3.5" style={{ color: hue }} fill={focused ? identity.color : 'none'} />
            <span className="text-[9px] font-bold" style={{ color: hue }}>{paneIndex + 1}</span>
          </span>
        )}
        {conn ? (
          <PaneHeaderTitle
            conn={conn}
            sessionId={sessionId}
            sessionTitle={sessionTitle}
            liveFolder={liveFolder}
            shellLabel={shellLabel}
            folderPath={folderPath}
            onOpenFolder={onOpenFolder}
            status={sessionId ? statuses[sessionId] ?? 'connecting' : undefined}
            busy={busy}
            darkMode={appearance?.darkMode}
          />
        ) : (
          <span className="truncate min-w-0 flex-1">Empty pane</span>
        )}
        {/* Only as wide as its buttons (at most half the header): the title's activity zone takes
            the rest, so the busy artwork travels right up to the first control. */}
        <span data-testid="pane-header-controls" className="ml-1 flex min-w-[3.5rem] max-w-[50%] flex-initial items-center justify-end gap-0.5" onMouseDown={(e) => { e.stopPropagation(); onFocus() }}>
          {conn && sessionId && (
            <SessionControlButtons
              conn={conn}
              sessionId={sessionId}
              busy={busy}
              sessionLive={(statuses[sessionId] ?? 'connecting') === 'connected'}
              detach={detach}
              onToggleDetach={onToggleDetach}
              onOpenCurrentDirectory={conn.type === 'LOCAL' ? onOpenCurrentDirectory : undefined}
              surface="header"
              detachWhere="pane"
              fullscreen={fullscreen}
              onToggleFullscreen={onToggleFullscreen}
              appearance={appearance ? {
                ...appearance,
                scopeLabel: `Pane ${paneIndex + 1}`,
                buttonTitle: `Appearance — theme & font size (Pane ${paneIndex + 1})`,
              } : undefined}
            />
          )}
          {/* Anchored group: renew, picker and close keep their spot whatever the controls before
              them do (overflowing into "More" as the pane narrows). */}
          <span className="flex flex-shrink-0 items-center gap-0.5" data-testid="pane-header-anchored">
            {conn?.type === 'LOCAL' && sessionId && (
              <Tooltip content="Renew session: restart this terminal (and its agent) fresh" placement="bottom">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); requestRenewFromPane(sessionId) }}
                  className="w-4 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors"
                  aria-label="Renew session"
                  data-testid="pane-renew-session-button"
                >
                  <RotateCw className="w-3 h-3" />
                </button>
              </Tooltip>
            )}
            {!single && (
              <Tooltip content="Choose session for this pane" placement="bottom">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onTogglePicker(e.currentTarget.getBoundingClientRect()) }}
                  className="w-4 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors"
                  aria-label="Choose session for this pane"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </Tooltip>
            )}
            {conn && sessionId && onClose && !single && (
              <Tooltip content="Close pane" placement="bottom">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onClose() }}
                  className="ml-1 w-4 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-theme-error/20 hover:text-theme-error transition-colors"
                  aria-label="Close pane"
                >
                  <X className="w-3 h-3" />
                </button>
              </Tooltip>
            )}
          </span>
        </span>
      </div>
      {pickerOpen && createPortal(
        <div
          ref={pickerRef}
          className="fixed z-50 max-w-[calc(100vw-1rem)] bg-theme-popup border border-theme-border rounded-lg shadow-2xl py-1 min-w-[190px] overflow-y-auto custom-scrollbar"
          style={pickerAnchor ? {
            left: Math.max(8, Math.min(pickerAnchor.left, window.innerWidth - 205)),
            ...(pickerOpensAbove
              ? { bottom: window.innerHeight - pickerAnchor.top + 4 }
              : { top: pickerBelowTop }),
            maxHeight: pickerMaxHeight,
          } : undefined}
        >
          {panes[paneIndex] && (
            <button
              type="button"
              onClick={onClear}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-theme-dim hover:bg-theme-bg hover:text-theme-error transition-colors"
            >
              <X className="w-3 h-3 flex-shrink-0" /> Empty this pane
            </button>
          )}
          {tabs.length === 0 ? (
            <div className="px-3 py-2 text-xs text-theme-dim">No open sessions</div>
          ) : (
            tabs.map(t => {
              const here = panes[paneIndex] === t.id
              // Already shown elsewhere? Name that pane by its own shape + hue, not a bare number.
              const otherPane = panes.findIndex((p, i) => p === t.id && i < layoutMode && i !== paneIndex)
              const other = otherPane !== -1 ? paneIdentity(otherPane) : null
              const OtherShape = other?.icon
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onAssign(t.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-theme-bg ${
                    here ? 'text-theme-accent' : 'text-theme-fg hover:text-white'
                  }`}
                >
                  {connType(t.connId) === 'RDP'
                    ? <Monitor className="w-3 h-3 flex-shrink-0" />
                    : <Terminal className="w-3 h-3 flex-shrink-0" />}
                  <SessionStatusIndicator status={statuses[t.id] ?? 'connecting'} isAgent={formatTerminalTitle(t.name).isAgent} />
                  <span className="truncate flex-1 text-left">{t.name}</span>
                  {here && <Check className="w-3 h-3 flex-shrink-0" />}
                  {OtherShape && other && (
                    <span className="flex items-center gap-0.5 flex-shrink-0" aria-label={`Shown in pane ${otherPane + 1} · ${other.label}`}>
                      <OtherShape className="w-3 h-3" style={{ color: other.color }} fill={other.color} />
                      <span className="text-[9px] font-bold" style={{ color: other.color }}>{otherPane + 1}</span>
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>, document.body
      )}
    </div>
  )
}

export default PaneHeader
