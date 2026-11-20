import { requestRenewFromPane } from '../../hooks/useRenewSession'
import type { MenuItem } from '../../ide/ui/Menu'
import { registerMenuGroup } from '../../ide/workbench/contributions'
import { agentBookmark } from '../../utils/agentBookmark'
import { moveSessionToTerminalWindow } from '../terminalDock/terminalDockActions'
import { dispatchTerminalCopy, dispatchTerminalSave } from '../../utils/terminalCopyExtract'

import { sessionById, useSessionBridge, type SessionInfo } from './sessionBridge'
import { parseSessionInput } from './sessionInput'

const CTRL_C = '\x03'
const CTRL_L = '\x0c'

const BOOKMARK_LABEL = {
  none: 'Bookmark Agent Session',
  pending: 'Cancel Pending Bookmark',
  bookmarked: 'Remove Bookmark',
} as const

function sendInput(session: SessionInfo, data: string): void {
  const api = window.omnitermAPI?.connect
  if (session.connType === 'SSH') api?.sshInput?.(session.id, data)
  else if (session.connType === 'LOCAL') api?.localInput?.(session.id, data)
}

/** Interrupts what runs in the session, like Ctrl+C typed into it (the tab stays). */
export function interruptSession(session: SessionInfo): void {
  const interrupt = window.omnitermAPI?.connect?.interruptSession
  if (session.connType === 'LOCAL' && interrupt) void interrupt(session.id).catch(() => sendInput(session, CTRL_C))
  else sendInput(session, CTRL_C)
  window.dispatchEvent(new CustomEvent('omniterm:terminal-interrupted', { detail: { id: session.id } }))
}

function themeItems(session: SessionInfo): MenuItem[] {
  const choice = useSessionBridge.getState().api?.terminalThemes?.(session.id)
  if (!choice || choice.themes.length === 0) return []
  return [{
    label: 'Terminal Theme',
    submenu: choice.themes.map((theme): MenuItem => ({
      label: theme.name,
      verbatim: true,
      checked: theme.id === choice.current,
      run: () => useSessionBridge.getState().api?.applyTerminalTheme?.(session.id, theme.id),
    })),
  }]
}

/**
 * What used to sit in the header row inside a session tab, offered on the tab's context menu and
 * its "⋮" menu instead: theme, stop, clear, copy, save, the agent bookmark, renew and the working
 * folder.
 */
export function sessionTabMenuItems(sessionId: string): MenuItem[] {
  const session = sessionById(sessionId)
  if (!session) return []
  const terminal = session.connType !== 'RDP'
  const live = session.status === 'connected'
  const local = session.connType === 'LOCAL'
  const items: MenuItem[] = [{ kind: 'separator' }, ...themeItems(session)]
  if (terminal) {
    items.push(
      { label: 'Stop Current Process', icon: 'stop', disabled: !live, run: () => interruptSession(session) },
      { label: 'Clear Terminal', disabled: !live, run: () => sendInput(session, CTRL_L) },
      {
        label: 'Copy',
        icon: 'copy',
        submenu: [
          { label: 'Copy Last Output', run: () => dispatchTerminalCopy(session.id, 'last-output') },
          { label: 'Copy Visible Screen', run: () => dispatchTerminalCopy(session.id, 'viewport') },
          { label: 'Copy All Terminal', run: () => dispatchTerminalCopy(session.id, 'all') },
        ],
      },
      { label: 'Save Terminal Output…', run: () => dispatchTerminalSave(session.id) },
    )
  }
  // The agent's own session, kept so it can be resumed after the tab is gone.
  const bookmark = agentBookmark(session.id)
  if (bookmark) items.push({ label: BOOKMARK_LABEL[bookmark.state], icon: 'bookmark', run: bookmark.toggle })
  if (local) items.push({ label: 'Renew Session', icon: 'refresh', run: () => requestRenewFromPane(session.id) })
  const folder = local ? session.cwd : null
  if (folder) {
    items.push({ label: 'Open Folder in Explorer', icon: 'folder-open', run: () => void window.omnitermAPI.app.openInSystem(folder) })
  }
  if (terminal) items.push({ label: 'Move to Terminal Tool Window', icon: 'toolwindow-terminal', run: () => moveSessionToTerminalWindow(session.id) })
  return items
}

/** Adds the session items to the editor tab menus of session tabs (other tabs get none). */
export function registerSessionTabMenu(): () => void {
  return registerMenuGroup({
    id: 'omniterm.sessionTab',
    menus: ['editorTab'],
    items: (_menu, ctx) => {
      const id = parseSessionInput(ctx.input)
      return id ? sessionTabMenuItems(id) : []
    },
  })
}
