import { useCallback, useRef, type MouseEvent } from 'react'

import type { WorkspaceRowActionsHandle } from './WorkspaceRowActions'

/** Wires a row's `onContextMenu` to its `WorkspaceRowActions` menu. */
export function useRowContextMenu() {
  const actionsRef = useRef<WorkspaceRowActionsHandle>(null)
  const onContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    // The context-menu key reports no pointer; the menu then opens under the row's own trigger.
    const fromKeyboard = event.clientX === 0 && event.clientY === 0
    if (fromKeyboard) actionsRef.current?.openAt()
    else actionsRef.current?.openAt(event.clientX, event.clientY)
  }, [])
  return { actionsRef, onContextMenu }
}
