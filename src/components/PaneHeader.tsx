import React from 'react'
import { Terminal, Monitor, ChevronDown, Check, X, ExternalLink, Minimize2 } from 'lucide-react'
import type { Connection, SessionStatus } from '@omniterm/contract'
import { STATUS_DOT } from '../tabVisuals'
import { paneIdentity, withAlpha } from '../paneIdentity'
import { detachTitle, type DetachAction } from '../detachControl'
import type { SessionTabItem } from './SessionTabs'
import AppearanceMenu from './AppearanceMenu'
import type { AppTheme } from '../themes'

/**
 * The mini header on top of every pane in split view: the pane's identity (shape + number in its own
 * hue — see paneIdentity.ts), the session it holds, a drag handle for rearranging panes, and a chevron
 * opening the picker that fills/re-assigns the pane.
 *
 * The identity hue is what ties a pane to its tabs in the strip above; focus is carried by brightness
 * and by a filled (vs outlined) shape, so the two signals never compete for the same colour.
 */
interface PaneHeaderProps {
  paneIndex: number
  /** Null while the pane is empty. */
  conn: Connection | null
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
  onTogglePicker: () => void
  onAssign: (tabId: string) => void
  onClear: () => void
  /** This pane's effective look, and the palette to change it — omitted while the pane is empty. */
  appearance?: {
    themes: AppTheme[]
    themeId: string
    fontSize: number
    darkMode: boolean
    onThemeApply: (themeId: string) => void
    onFontSizeChange: (delta: number) => void
  }
}

const PaneHeader: React.FC<PaneHeaderProps> = ({
  paneIndex, conn, focused, sessionId, tabs, panes, layoutMode, statuses, connType,
  pickerOpen, pickerRef, detach, onToggleDetach, onFocus, onDragStart, onDragEnd, onTogglePicker,
  onAssign, onClear, appearance,
}) => {
  const identity = paneIdentity(paneIndex)
  const Shape = identity.icon
  const hue = focused ? identity.color : withAlpha(identity.color, 0.55)
  return (
    <div className="relative flex-shrink-0">
      <div
        draggable={!!conn}
        onDragStart={conn ? (e) => {
          e.dataTransfer.setData('text/plain', String(paneIndex))
          e.dataTransfer.effectAllowed = 'move'
          onDragStart()
        } : undefined}
        onDragEnd={onDragEnd}
        onMouseDown={onFocus}
        className={`h-6 flex items-center gap-1.5 px-2 text-[11px] select-none ${conn ? 'cursor-grab active:cursor-grabbing' : ''} ${
          focused ? 'bg-theme-bg text-theme-fg' : 'bg-theme-sidebar text-theme-dim'
        }`}
        title={conn ? `Pane ${paneIndex + 1} · ${identity.label} — drag to move this session to another pane` : `Pane ${paneIndex + 1} · ${identity.label}`}
      >
        <span className="flex items-center gap-1 flex-shrink-0">
          <Shape className="w-3.5 h-3.5" style={{ color: hue }} fill={focused ? identity.color : 'none'} />
          <span className="text-[9px] font-bold" style={{ color: hue }}>{paneIndex + 1}</span>
        </span>
        {conn ? (
          <>
            {conn.type === 'RDP'
              ? <Monitor className="w-3 h-3 flex-shrink-0" />
              : <Terminal className="w-3 h-3 flex-shrink-0" />}
            <span className="truncate font-medium min-w-0 flex-1">{conn.name}</span>
            {sessionId && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[statuses[sessionId] ?? 'connecting']}`} />}
          </>
        ) : (
          <span className="truncate min-w-0 flex-1">Empty pane</span>
        )}
        <span className="ml-auto flex items-center gap-0.5 flex-shrink-0" onMouseDown={(e) => { e.stopPropagation(); onFocus() }}>
          {appearance && (
            <AppearanceMenu
              themes={appearance.themes}
              themeId={appearance.themeId}
              fontSize={appearance.fontSize}
              darkMode={appearance.darkMode}
              scopeLabel={`Pane ${paneIndex + 1}`}
              buttonTitle={`Appearance — theme & font size (Pane ${paneIndex + 1})`}
              onThemeApply={appearance.onThemeApply}
              onFontSizeChange={appearance.onFontSizeChange}
              compact
            />
          )}
          {detach && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleDetach() }}
              className="w-4 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors"
              title={detachTitle(detach, 'pane')}
              aria-label={detachTitle(detach, 'pane')}
            >
              {detach === 'attach' ? <Minimize2 className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTogglePicker() }}
            className="w-4 h-4 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors"
            title="Choose session for this pane"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </span>
      </div>
      {pickerOpen && (
        <div
          ref={pickerRef}
          className="absolute top-full left-0 mt-0.5 z-50 bg-theme-popup border border-theme-border rounded-lg shadow-2xl py-1 min-w-[190px] max-h-[260px] overflow-y-auto no-scrollbar"
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
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[statuses[t.id] ?? 'connecting']}`} />
                  <span className="truncate flex-1 text-left">{t.name}</span>
                  {here && <Check className="w-3 h-3 flex-shrink-0" />}
                  {OtherShape && other && (
                    <span className="flex items-center gap-0.5 flex-shrink-0" title={`Shown in pane ${otherPane + 1} · ${other.label}`}>
                      <OtherShape className="w-3 h-3" style={{ color: other.color }} fill={other.color} />
                      <span className="text-[9px] font-bold" style={{ color: other.color }}>{otherPane + 1}</span>
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

export default PaneHeader
