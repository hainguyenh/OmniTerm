import { useTitleControlsProps } from '../titleControlsStore'

import { sessionById } from './sessionBridge'

/**
 * Steps one session terminal's font size through the app's appearance controls (a per-terminal
 * override, as the title bar's font size control sets). 0 (reset) is left to those controls.
 */
export function stepSessionFontSize(sessionId: string, delta: number): void {
  const session = sessionById(sessionId)
  const change = useTitleControlsProps.getState().props?.onFontSizeChange
  if (!session || !change || delta === 0) return
  change(delta, { id: session.id, connId: session.connId })
}
