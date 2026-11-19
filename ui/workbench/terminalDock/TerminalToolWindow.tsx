import { useEffect, useRef, useState, type RefObject } from 'react'


import { Button, EmptyState, IconButton } from '../../ide/ui'
import { showContextMenu } from '../../ide/ui/Menu'
import { registerDropTarget } from '../../ide/ui/pointerDrag'
import { Tabs, type TabItem } from '../../ide/ui/Tabs'
import { EDITOR_TAB_MIME } from '../../ide/workbench/contributions'
import { useToolWindowLayout } from '../../ide/workbench/toolwindows/store'
import { loadShellOptions } from '../../shellOptions'
import { useSessionBridge } from '../sessions/sessionBridge'
import { confirmSessionClose } from '../sessions/sessionClose'
import { SessionColorMark } from '../sessions/SessionColorMark'
import { SESSION_DRAG } from '../sessions/sessionDrag'
import { sessionInput } from '../sessions/sessionInput'
import { showSessionTab } from '../sessions/sessionTabActions'
import { SessionTabStatus } from '../sessions/SessionTabStatus'
import { focusSessionTerminal } from '../sessions/sessionTerminalFocus'
import { agentProfileOf, sessionTabTitle } from '../sessions/sessionTabTitle'
import { claimSurface, releaseSurface, setSurfaceShown } from '../sessions/surfaceRegistry'

import { draggedSession } from './draggedSession'
import { moveSessionToTerminalWindow, projectMenuItems, requestDockedTerminal, shellMenuItems, TERMINAL_WINDOW } from './terminalDockActions'
import { selectDocked, undockSession, useTerminalDock } from './terminalDockStore'

/** Whether the Terminal tool window is the one its area shows (it stays mounted while hidden). */
function useTerminalWindowShown(): boolean {
  return useToolWindowLayout((state) => Object.values(state.visible).includes(TERMINAL_WINDOW))
}

/** The docked session the window shows: the active one, else the first. */
function useShownDocked(): string | null {
  return useTerminalDock((state) => (state.active && state.docked.includes(state.active) ? state.active : state.docked[0] ?? null))
}

/** Lends this box to the session's terminal surface, like an editor tab does (no remount). */
function DockedSurface({ sessionId, shown }: { sessionId: string; shown: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const shownRef = useRef(shown)
  shownRef.current = shown
  const [owner] = useState(() => Symbol('terminal-dock'))
  useEffect(() => {
    const container = ref.current
    if (!container) return undefined
    claimSurface(sessionId, owner, container, shownRef.current)
    return () => releaseSurface(sessionId, owner)
  }, [sessionId, owner])
  useEffect(() => setSurfaceShown(sessionId, owner, shown), [sessionId, owner, shown])
  return <div ref={ref} className="relative h-full w-full min-h-0 min-w-0" data-terminal-dock-surface={sessionId} />
}

/** Dropping a session's editor tab (or its Sessions row) on the window docks it here. */
function useSessionDrop(ref: RefObject<HTMLDivElement | null>): boolean {
  const [over, setOver] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    return registerDropTarget(el, {
      accepts: (type) => type === EDITOR_TAB_MIME || type === SESSION_DRAG,
      over: (data) => setOver(draggedSession(data.type, data.payload) !== null),
      leave: () => setOver(false),
      drop: (data) => {
        setOver(false)
        const id = draggedSession(data.type, data.payload)
        if (id) moveSessionToTerminalWindow(id)
      },
    })
  }, [ref])
  return over
}

/** The Terminal tool window's content: the shown docked session, or a way to start one. */
export function TerminalToolWindow() {
  const sessionId = useShownDocked()
  const shown = useTerminalWindowShown()
  const exists = useSessionBridge((state) => !!sessionId && state.sessions.some((session) => session.id === sessionId))
  const ref = useRef<HTMLDivElement>(null)
  const over = useSessionDrop(ref)
  return (
    <div ref={ref} className="relative h-full w-full min-h-0 min-w-0" data-terminal-dock-drop={over ? 'over' : undefined}>
      {sessionId && exists ? (
        <DockedSurface key={sessionId} sessionId={sessionId} shown={shown} />
      ) : (
        <EmptyState title="No terminal sessions" actions={<Button onClick={() => requestDockedTerminal()}>New Terminal</Button>}>
          Terminals opened here stay below the editor. Drag a terminal tab here, or move one from its tab menu.
        </EmptyState>
      )}
      {over && <div aria-hidden className="pointer-events-none absolute inset-0 border-2 border-dashed border-[var(--accent)]" />}
    </div>
  )
}

async function closeDocked(id: string): Promise<void> {
  if (!(await confirmSessionClose([sessionInput(id)]))) return
  undockSession(id)
  useSessionBridge.getState().api?.killSession(id)
}

/**
 * Picking a docked tab hands the keyboard to its terminal. Switching to another session also
 * focuses it once its surface is attached here; this covers picking the tab already shown.
 */
function selectDockedTab(id: string): void {
  selectDocked(id)
  focusSessionTerminal(id)
}

function moveToEditor(id: string): void {
  undockSession(id)
  showSessionTab(id)
}

/** The docked sessions as tabs in the window's header, with "+" for a new one. */
export function TerminalDockTabs() {
  const docked = useTerminalDock((state) => state.docked)
  const active = useShownDocked()
  const sessions = useSessionBridge((state) => state.sessions)
  const items: TabItem[] = docked.flatMap((id) => {
    const session = sessions.find((item) => item.id === id)
    if (!session) return []
    const title = sessionTabTitle(session, agentProfileOf(id))
    return [{
      id,
      label: title,
      text: title,
      icon: 'terminal',
      closable: true,
      tooltip: session.location ?? title,
      trailing: (
        <>
          <SessionColorMark sessionId={id} />
          <SessionTabStatus sessionId={id} />
        </>
      ),
    }]
  })
  return (
    <Tabs
      variant="compact"
      aria-label="Terminal sessions"
      items={items}
      activeId={active}
      onSelect={selectDockedTab}
      onClose={(id) => void closeDocked(id)}
      onContextMenu={(id, event) => {
        event.preventDefault()
        showContextMenu(event, [
          { label: 'Move to Editor', icon: 'split', run: () => moveToEditor(id) },
          { kind: 'separator' },
          { label: 'Close Tab', icon: 'close', run: () => void closeDocked(id) },
        ])
      }}
      trailing={
        <>
          <IconButton icon="plus" size="small" title="New Terminal" onClick={() => requestDockedTerminal()} data-feature="p2.shell.terminalToolwindow.new" />
          <IconButton
            icon="chevron-down"
            size="small"
            title="New Terminal With…"
            aria-haspopup="menu"
            onClick={(event) => void showShellMenu(event.currentTarget.getBoundingClientRect())}
            data-testid="terminal-dock-shells"
          />
        </>
      }
    />
  )
}

async function showShellMenu(anchor: DOMRect): Promise<void> {
  const options = await loadShellOptions()
  showContextMenu({ x: anchor.left, y: anchor.bottom + 2 }, [...shellMenuItems(options), ...projectMenuItems(options)])
}
