import type { Connection, SessionStatus } from '@omniterm/contract'

/**
 * Which way a detach/attach control points.
 *
 * The same button appears in three places — the session footer, every pane (dock) header, and the
 * title bar of a popped-out window — so the decision of what it does, and whether it should be there
 * at all, lives here rather than being re-derived at each call site.
 */
export type DetachAction = 'detach' | 'attach'

export interface DetachStateInput {
  /** Null/undefined for an empty pane or a tab that holds a script editor rather than a session. */
  conn: Connection | null | undefined
  status: SessionStatus | undefined
  /** RDP only: popped out into a maximized native window (fullscreen feel). */
  rdpDetached?: boolean
  /** SSH/LOCAL only: running in its own OmniTerm window. */
  poppedOut?: boolean
  /** False when the backend exposes no detach command — keeps a dead button out of the chrome. */
  canDetachWindow?: boolean
}

/**
 * `'detach'` to pop the session out, `'attach'` to fold it back, or null when it cannot move.
 *
 * Nothing to move: an empty pane, an editor tab (no connection), or a shell that has already exited —
 * popping out a dead session would open a window onto nothing. The one case that always stays
 * reachable is the way *back*: once a session is out, `'attach'` is offered regardless of status, so a
 * connection that drops while detached can never leave its window stranded.
 */
export function detachAction({
  conn, status, rdpDetached = false, poppedOut = false, canDetachWindow = false,
}: DetachStateInput): DetachAction | null {
  if (!conn) return null

  if (conn.type === 'RDP') {
    if (rdpDetached) return 'attach'
    return status === 'connected' ? 'detach' : null
  }

  if (poppedOut) return 'attach'
  if (!canDetachWindow) return null
  return status === 'closed' || status === 'error' ? null : 'detach'
}

/** Tooltip for the control, phrased for where it sits. */
export function detachTitle(action: DetachAction, where: 'pane' | 'footer' | 'window'): string {
  if (action === 'attach') {
    return where === 'window' ? 'Re-attach into the main window' : 'Attach back into this tab'
  }
  return where === 'pane' ? 'Detach this pane into its own window' : 'Detach into its own window'
}
