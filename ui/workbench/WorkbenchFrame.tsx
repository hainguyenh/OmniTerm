import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { activateWorkbenchFeatures, DEFERRED_WORKBENCH_STEPS, WORKBENCH_STEPS } from './activateWorkbenchFeatures'
import { DialogsSlot } from './SessionsViews'
import { SessionsHostContext, useSessionsHost } from './sessionsHostCore'
import { WorkbenchShell } from './WorkbenchShell'

/**
 * Shows the OmniTerm shell inside the real IDE workbench. Every session is an editor tab; the shell
 * itself (the sessions' terminals, dialogs and overlays) is rendered once into a detached DOM host
 * node via a portal, so navigating tabs, splitting or switching workspace never unmounts or restarts
 * a terminal.
 */
export function WorkbenchFrame({ children }: { children: ReactNode }) {
  const host = useSessionsHost()
  const [activated, setActivated] = useState(false)
  useEffect(() => {
    const release = activateWorkbenchFeatures(WORKBENCH_STEPS, DEFERRED_WORKBENCH_STEPS)
    setActivated(true)
    return () => {
      release()
      setActivated(false)
    }
  }, [])
  return (
    <SessionsHostContext.Provider value={host}>
      {createPortal(children, host)}
      {activated && <WorkbenchShell />}
      {activated && <DialogsSlot host={host} />}
    </SessionsHostContext.Provider>
  )
}
