import { useCallback } from 'react'
import type { Connection, SessionStatus } from '@omniterm/contract'
import { detachAction, type DetachAction } from '../detachControl'

interface TabRef {
  id: string
  connId?: string
}

export interface UseDetachControlInput {
  tabs: TabRef[]
  connById: (connId?: string) => Connection | undefined
  /** A script-editor tab holds no session, so it can never be detached. */
  isEditorTab: (sessionId: string) => boolean
  statuses: Record<string, SessionStatus>
  /** RDP sessions popped out to a maximized native window. */
  rdpDetached: Record<string, boolean>
  /** SSH/LOCAL sessions running in their own OmniTerm window. */
  poppedOut: Record<string, boolean>
  canDetachWindow: boolean
  onRdpToggle: (sessionId: string) => void
  onPopOut: (sessionId: string) => void
  onAttach: (sessionId: string) => void
}

export interface DetachControl {
  /** Which way the button for this session points, or null to omit it entirely. */
  stateOf: (sessionId: string | null) => DetachAction | null
  /** Acts in whichever direction `stateOf` reports; a no-op when it reports none. */
  toggle: (sessionId: string | null) => void
}

/**
 * Backs the detach/attach button wherever it appears — the session footer, every pane (dock) header,
 * and the popped-out window's own title bar.
 *
 * Each dock carrying its own button is the point: before this, popping a session out meant first
 * clicking its tab to make it active, because the footer button only ever acted on the active tab.
 * Sharing one `stateOf`/`toggle` pair is what keeps three buttons from drifting into three slightly
 * different ideas of when detaching is allowed.
 */
export function useDetachControl({
  tabs, connById, isEditorTab, statuses, rdpDetached, poppedOut, canDetachWindow,
  onRdpToggle, onPopOut, onAttach,
}: UseDetachControlInput): DetachControl {
  const connOf = useCallback(
    (sessionId: string): Connection | null =>
      isEditorTab(sessionId) ? null : connById(tabs.find(t => t.id === sessionId)?.connId) ?? null,
    [isEditorTab, connById, tabs],
  )

  const stateOf = useCallback((sessionId: string | null): DetachAction | null => {
    if (!sessionId) return null
    return detachAction({
      conn: connOf(sessionId),
      status: statuses[sessionId],
      rdpDetached: rdpDetached[sessionId],
      poppedOut: poppedOut[sessionId],
      canDetachWindow,
    })
  }, [connOf, statuses, rdpDetached, poppedOut, canDetachWindow])

  const toggle = useCallback((sessionId: string | null) => {
    const action = sessionId ? stateOf(sessionId) : null
    if (!sessionId || !action) return
    // RDP pops out as a native fullscreen window; everything else into its own OmniTerm window.
    if (connOf(sessionId)?.type === 'RDP') onRdpToggle(sessionId)
    else if (action === 'attach') onAttach(sessionId)
    else onPopOut(sessionId)
  }, [stateOf, connOf, onRdpToggle, onAttach, onPopOut])

  return { stateOf, toggle }
}
