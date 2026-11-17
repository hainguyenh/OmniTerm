import { useEffect, useRef, useState } from 'react'

import { registerFontZoomSurface, useEditorShown, type EditorInput } from '../../ide/workbench/contributions'

import { useSessionBridge } from './sessionBridge'
import { stepSessionFontSize } from './sessionFontSize'
import { parseSessionInput } from './sessionInput'
import { SessionAgentFooter, SessionAgentHeader } from './SessionAgentHeader'
import { claimSurface, releaseSurface, setSurfaceShown } from './surfaceRegistry'

/**
 * The editor tab of one session. It owns no terminal: it only lends its box to the session's
 * surface, which a DOM move attaches here, so splitting, dragging and switching tabs never
 * remount the xterm (see surfaceRegistry.ts).
 */
export function SessionTab({ input }: { input: EditorInput }) {
  const sessionId = parseSessionInput(input)
  const ref = useRef<HTMLDivElement>(null)
  const shown = useEditorShown()
  const shownRef = useRef(shown)
  shownRef.current = shown
  const [owner] = useState(() => Symbol('session-tab'))
  const exists = useSessionBridge((state) => state.sessions.some((session) => session.id === sessionId))

  useEffect(() => {
    const container = ref.current
    if (!sessionId || !container) return undefined
    claimSurface(sessionId, owner, container, shownRef.current)
    return () => releaseSurface(sessionId, owner)
  }, [sessionId, owner])

  useEffect(() => {
    if (sessionId) setSurfaceShown(sessionId, owner, shown)
  }, [sessionId, owner, shown])

  // The pane's font size controls (and Increase / Decrease Font Size) step this session's terminal.
  useEffect(() => {
    const container = ref.current
    if (!sessionId || !container) return undefined
    return registerFontZoomSurface(container, (delta) => stepSessionFontSize(sessionId, delta))
  }, [sessionId])

  // The surface box keeps its place below the optional agent header, so the header coming and
  // going only resizes the terminal; it never re-parents it.
  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col">
      {sessionId && <SessionAgentHeader sessionId={sessionId} />}
      <div ref={ref} className="relative w-full min-h-0 min-w-0 flex-1" data-session-tab={sessionId ?? undefined}>
        {!exists && (
          <div className="absolute inset-0 flex items-center justify-center text-sm opacity-60" role="status">
            This session is not running in this window.
          </div>
        )}
        {sessionId && <SessionAgentFooter sessionId={sessionId} />}
      </div>
    </div>
  )
}
