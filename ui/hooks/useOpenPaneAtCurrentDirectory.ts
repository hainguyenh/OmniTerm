import { useCallback, useEffect } from 'react'
import type { LayoutMode } from '../themes'
import { paneOrder } from '../paneLayout'
import type { useMainLayoutBase } from '../components/useMainLayoutBase'

/** Open another local terminal at a pane's exact live cwd and reserve a visible pane for it. */
export function useOpenPaneAtCurrentDirectory(
  base: ReturnType<typeof useMainLayoutBase>,
  changeLayoutMode: (mode: LayoutMode) => void,
) {
  const {
    activeTabs = [], panes = [], focusedPane = 0, layoutMode, appSettings, sessionCwds,
    connById = () => undefined, setPanes = () => {}, setFocusedPane = () => {}, requestNewSession,
  } = base

  const openPaneAtCurrentDirectory = useCallback((paneIndex: number) => {
    const sessionId = panes[paneIndex]
    if (!sessionId) return
    const tab = activeTabs.find(item => item.id === sessionId)
    const conn = connById(tab?.connId)
    if (!conn || conn.type !== 'LOCAL') return
    const cwd = sessionCwds[sessionId] ?? conn.localCwd
    if (!cwd) return

    if (layoutMode < 8) {
      const nextLayout = (layoutMode + 1) as LayoutMode
      const order = paneOrder(nextLayout, appSettings.split3Style ?? 'left', appSettings.split2Style ?? 'columns')
      const newPaneIndex = order[layoutMode]
      changeLayoutMode(nextLayout)
      // Layout expansion normally back-fills empty panes with background tabs. Reserve the newly
      // exposed slot for the current-directory terminal instead.
      setPanes(prev => prev.map((id, index) => index === newPaneIndex ? null : id))
      setFocusedPane(newPaneIndex)
    }
    requestNewSession(conn.shell, null, cwd)
  }, [activeTabs, appSettings.split2Style, appSettings.split3Style, changeLayoutMode, connById, layoutMode, panes, requestNewSession, sessionCwds, setFocusedPane, setPanes])

  useEffect(() => {
    const handleOpen = () => openPaneAtCurrentDirectory(focusedPane)
    window.addEventListener('omniterm:new-pane-current-directory', handleOpen)
    return () => window.removeEventListener('omniterm:new-pane-current-directory', handleOpen)
  }, [focusedPane, openPaneAtCurrentDirectory])

  return openPaneAtCurrentDirectory
}
