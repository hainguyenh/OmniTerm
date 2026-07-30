import React from 'react'
import { Plus, Terminal, Monitor, FileText, Unplug, ChevronDown, Play, Locate } from 'lucide-react'
import type { Connection, SessionStatus } from '@omniterm/contract'
import { activityDot, tabClasses, tabPlacement, tabTitle, PLACEMENT_STRIPE, type TabFlags } from '../tabVisuals'
import { paneIdentity, withAlpha } from '../paneIdentity'

/**
 * The session tab strip.
 *
 * Two independent visual axes keep a long strip readable:
 *
 *  - **Where is it?** — a docked tab is stamped with the shape and hue of the pane it lives in (see
 *    paneIdentity.ts): the leading icon becomes that pane's shape, and its stripe/border/badge take
 *    that hue, solid in the focused pane and half-strength in the others. A tab in no visible pane has
 *    no stripe and no fill, so "running somewhere off-screen" never looks docked.
 *  - **Is it doing anything?** — for a session not docked anywhere, the icon says what it *is*: `Play`
 *    while the shell has something running (a process, an ssh, a script it was launched with),
 *    `Terminal` with a hollow dot while it waits at its prompt, `Unplug` once it is gone. Activity is
 *    only knowable for local shells under the Tauri backend; elsewhere `busy` is undefined and the tab
 *    keeps the plain connection-status look.
 *
 * Preview (temporary) tabs render italic: opened for a look, replaced by the next preview open unless
 * promoted (double-click, or editing the file).
 */
export interface SessionTabItem {
  id: string
  connId: string
  name: string
}

interface SessionTabsProps {
  tabs: SessionTabItem[]
  panes: (string | null)[]
  layoutMode: number
  focusedPane: number
  statuses: Record<string, SessionStatus>
  /** Whether each local shell is running something; a missing entry means idle/unknown. */
  activity: Record<string, boolean>
  /** Editor tabs own no backend session, so they show no status dot. */
  isEditor: (tabId: string) => boolean
  isPreview: (tabId: string) => boolean
  isEphemeral: (connId: string) => boolean
  connType: (connId: string) => Connection['type'] | undefined
  onSelect: (tabId: string) => void
  /** Double-click — turns a preview tab into a kept one. */
  onPromote: (tabId: string) => void
  onClose: (tabId: string) => void
  onContextMenu: (e: React.MouseEvent, tabId: string) => void
  onNewSession: () => void
  onPickShell: (rect: DOMRect) => void
  /**
   * Reveal this editor tab's file in the Workspace tree (expand its folders, scroll to it, flash a
   * highlight). Only ever called for a file tab that is also the focused pane's tab — see the
   * `editor && placement === 'focused'` gate below.
   */
  onReveal: (tabId: string) => void
}

const SessionTabs: React.FC<SessionTabsProps> = ({
  tabs, panes, layoutMode, focusedPane, statuses, activity,
  isEditor, isPreview, isEphemeral, connType,
  onSelect, onPromote, onClose, onContextMenu, onNewSession, onPickShell, onReveal,
}) => (
  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0">
    {tabs.map(tab => {
      const editor = isEditor(tab.id)
      const preview = isPreview(tab.id)
      const ephemeral = isEphemeral(tab.connId)
      const type = connType(tab.connId)
      // Editor tabs have no session of their own; everything else defaults to 'connecting' until the
      // backend reports otherwise. Activity is only ever reported for LOCAL shells.
      const status: SessionStatus | null = editor ? null : (statuses[tab.id] ?? 'connecting')
      const busy = editor || type !== 'LOCAL' ? undefined : (activity[tab.id] ?? false)
      const flags: TabFlags = { ephemeral, preview, status, busy }
      const paneIdx = panes.findIndex((p, i) => p === tab.id && i < layoutMode)
      const placement = tabPlacement(paneIdx, focusedPane)
      const docked = placement !== 'background'
      const identity = docked ? paneIdentity(paneIdx) : null
      // Docked: the pane's shape replaces the type icon — the pane header right below the tab still
      // shows what kind of session it is. Otherwise the icon carries the activity/kind.
      const Icon = identity?.icon
        ?? (editor ? FileText
          : status === 'closed' ? Unplug
          : type === 'RDP' ? Monitor
          : busy ? Play
          : Terminal)
      const hue = identity
        ? (placement === 'focused' ? identity.color : withAlpha(identity.color, 0.55))
        : undefined
      const stripe = PLACEMENT_STRIPE[placement]
      return (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          onDoubleClick={() => onPromote(tab.id)}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(tab.id) } }}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault() }}
          onContextMenu={(e) => onContextMenu(e, tab.id)}
          title={tabTitle(tab.name, placement, paneIdx, layoutMode, flags, identity?.label)}
          style={identity ? { borderColor: hue } : undefined}
          className={`group relative flex items-center gap-1.5 pl-2.5 pr-1 py-0.5 rounded cursor-pointer
            border transition-colors flex-shrink-0 select-none max-w-[180px] ${tabClasses(placement, flags)}`}
        >
          {stripe && (
            <span className={`absolute left-0 top-1 bottom-1 w-[3px] rounded-full ${identity ? '' : stripe}`}
              style={identity ? { backgroundColor: hue } : undefined} />
          )}
          <Icon
            className={`w-3.5 h-3.5 flex-shrink-0 ${!identity && (editor || busy) ? 'text-theme-accent' : ''}`}
            style={identity ? { color: hue } : undefined}
            fill={identity && placement === 'focused' ? identity.color : 'none'}
          />
          {status && (
            <span
              className={`w-2 h-2 rounded-full border flex-shrink-0 ${activityDot(flags)} ${
                status === 'connecting' ? 'animate-pulse' : ''
              }`}
            />
          )}
          <span className={`truncate text-xs font-medium ${preview ? 'italic' : ''} ${
            status === 'error' ? 'text-theme-error' : ''
          }`}>
            {tab.name}
          </span>
          {/* Pane number badge — which split pane this tab occupies right now, in that pane's hue. */}
          {layoutMode > 1 && identity && (
            <span
              className="flex-shrink-0 w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center"
              style={placement === 'focused'
                ? { backgroundColor: identity.color, color: '#1a1b26' }
                : { backgroundColor: withAlpha(identity.color, 0.2), color: identity.color }}
            >
              {paneIdx + 1}
            </span>
          )}
          {/* Only for the file tab currently shown in the focused pane — the tab the user is looking
              at right now — and only for a file, never a terminal/RDP session (no folder to reveal). */}
          {editor && placement === 'focused' && (
            <button
              onClick={e => { e.stopPropagation(); onReveal(tab.id) }}
              className="flex-shrink-0 w-4 h-4 rounded flex items-center justify-center text-theme-dim
                hover:text-theme-accent hover:bg-theme-popup transition-colors"
              title="Reveal in workspace tree"
            >
              <Locate className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onClose(tab.id) }}
            className="flex-shrink-0 w-4 h-4 rounded flex items-center justify-center text-theme-dim
              hover:text-theme-error hover:bg-theme-popup transition-colors text-base leading-none"
            title="Close tab"
          >
            ×
          </button>
        </div>
      )
    })}
    <div className="flex ml-1 rounded flex-shrink-0">
      <button
        type="button"
        onClick={onNewSession}
        className="inline-flex items-center justify-center w-7 h-7 rounded-l hover:bg-theme-bg/50 text-theme-dim hover:text-theme-fg transition-colors"
        title="New Terminal (Ctrl+N)"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={(e) => onPickShell(e.currentTarget.getBoundingClientRect())}
        className="inline-flex items-center justify-center px-1 rounded-r hover:bg-theme-bg/50 text-theme-dim hover:text-theme-fg transition-colors border-l border-theme-border/30"
        title="Select Shell"
      >
        <ChevronDown className="w-3 h-3" />
      </button>
    </div>
  </div>
)

export default SessionTabs
