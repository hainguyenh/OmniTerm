import { create } from 'zustand'

import { diag } from '../../diag'
import { editorController, useTabs } from '../../ide/editor/core/controller'
import { editorService, notifications, type EditorInput } from '../../ide/workbench/contributions'

import { dockSession, isDocked, undockSession } from '../terminalDock/terminalDockStore'

import { sessionCloseNeedsConfirm } from './sessionBusy'
import { sessionById, useSessionBridge } from './sessionBridge'
import { parseSessionInput, sessionInput } from './sessionInput'

/** How long a double Ctrl+C close can be undone; the session is killed when it lapses. */
export const UNDO_CLOSE_MS = 8000

/** Sessions whose tab closes without asking: a double Ctrl+C, an exit, or a reconciler cleanup. */
const authorized = new Set<string>()
/** Sessions whose tab closes without killing the session (not this window's, or a deferred kill). */
const keepAlive = new Set<string>()
const undoTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Sessions closed with Undo from the Terminal tool window: Undo docks them again. */
const closedFromDock = new Set<string>()

/** The dialog the session kind's `confirmClose` waits on (rendered by SessionCloseConfirmHost). */
export const useCloseConfirm = create<{
  request: { multiple: boolean; resolve: (ok: boolean) => void } | null
}>(() => ({ request: null }))

function askToClose(multiple: boolean): Promise<boolean> {
  useCloseConfirm.getState().request?.resolve(false)
  return new Promise<boolean>((resolve) => {
    useCloseConfirm.setState({
      request: {
        multiple,
        resolve: (ok) => {
          useCloseConfirm.setState({ request: null })
          resolve(ok)
        },
      },
    })
  })
}

/** `confirmClose` of the session kind: a busy session asks (unless the user turned asking off). */
export async function confirmSessionClose(inputs: EditorInput[]): Promise<boolean> {
  const { api } = useSessionBridge.getState()
  const needing = inputs.flatMap((input) => {
    const id = parseSessionInput(input)
    const info = id ? sessionById(id) : undefined
    if (!id || !info || authorized.has(id) || keepAlive.has(id)) return []
    return sessionCloseNeedsConfirm(info.status, info.connType, info.busy) ? [id] : []
  })
  if (needing.length === 0 || api?.skipConfirm()) return true
  return askToClose(needing.length > 1)
}

/** The answer of the close dialog ("Don't ask again" included). */
export function answerCloseConfirm(ok: boolean, applyToAll = false): void {
  if (ok && applyToAll) useSessionBridge.getState().api?.setSkipConfirm()
  useCloseConfirm.getState().request?.resolve(ok)
}

/** `onClose` of the session kind: the last tab of a session went, so the session is killed. */
export function onSessionTabClosed(input: EditorInput): void {
  const id = parseSessionInput(input)
  if (!id) return
  authorized.delete(id)
  if (keepAlive.has(id)) return
  useSessionBridge.getState().api?.killSession(id)
}

/** Closes a session's tab(s) without asking and without touching the session. */
export async function closeTabSilently(id: string): Promise<void> {
  const key = sessionInput(id).key
  authorized.add(id)
  keepAlive.add(id)
  try {
    await editorController().closeInput(key)
  } finally {
    authorized.delete(id)
    keepAlive.delete(id)
  }
}

function startUndoTimer(id: string): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    undoTimers.delete(id)
    keepAlive.delete(id)
    closedFromDock.delete(id)
    useSessionBridge.getState().api?.killSession(id)
  }, UNDO_CLOSE_MS)
  undoTimers.set(id, timer)
  return timer
}

function notifyClosed(id: string): void {
  notifications().notify({
    level: 'info',
    title: `Closed ${sessionById(id)?.name ?? 'terminal'}`,
    actions: [{ label: 'Undo', run: () => undoSessionClose(id) }],
    key: `session-close:${id}`,
  })
}

/** Ctrl+C pressed twice: close the tab at once, kill the session after a grace period. */
export async function closeSessionTabWithUndo(id: string): Promise<void> {
  if (undoTimers.has(id)) return
  if (isDocked(id)) {
    // A docked session has no editor tab: it leaves the Terminal tool window instead. The pending
    // undo keeps the reconciler from giving it a tab meanwhile.
    startUndoTimer(id)
    closedFromDock.add(id)
    undockSession(id)
    notifyClosed(id)
    return
  }
  const key = sessionInput(id).key
  authorized.add(id)
  keepAlive.add(id)
  const timer = startUndoTimer(id)
  let closed = false
  try {
    closed = await editorController().closeInput(key)
  } finally {
    authorized.delete(id)
  }
  if (!closed) {
    clearTimeout(timer)
    undoTimers.delete(id)
    keepAlive.delete(id)
    return
  }
  notifyClosed(id)
}

/** The Undo action: reopens the tab; a session that already ended is started again. */
export function undoSessionClose(id: string): void {
  const timer = undoTimers.get(id)
  if (!timer) return
  clearTimeout(timer)
  undoTimers.delete(id)
  keepAlive.delete(id)
  const { api } = useSessionBridge.getState()
  const info = sessionById(id)
  const docked = closedFromDock.delete(id)
  if (!info) return
  if (info.status === 'closed' || info.status === 'error') api?.reconnect(id)
  if (docked) {
    dockSession(id)
    return
  }
  editorService()
    .openInput(sessionInput(id), { focus: true })
    .catch((error: unknown) => diag.warn('[sessions] could not reopen the closed session tab', error))
}

/** A session being killed after an undo window must not get its tab back from the reconciler. */
export function isClosePending(id: string): boolean {
  return undoTimers.has(id)
}

/**
 * `omniterm:close-tab`: a terminal that names itself (double Ctrl+C) closes its own tab with Undo;
 * Ctrl+W carries no id and closes the active editor tab (asking first when a session is busy).
 */
export function closeSessionFromEvent(id: string | undefined): void {
  if (id) {
    void closeSessionTabWithUndo(id).catch((error: unknown) => diag.warn('[sessions] close failed', error))
    return
  }
  const state = useTabs.getState()
  const pane = state.panes[state.activePane]
  if (!pane?.active) return
  void editorController().closeTab(pane.id, pane.active)
}

/** Test hook. */
export function resetSessionClose(): void {
  for (const timer of undoTimers.values()) clearTimeout(timer)
  undoTimers.clear()
  closedFromDock.clear()
  authorized.clear()
  keepAlive.clear()
  useCloseConfirm.setState({ request: null })
}
