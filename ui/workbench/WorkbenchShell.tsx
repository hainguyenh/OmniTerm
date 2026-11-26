import { useEffect } from 'react'

import { Breadcrumbs } from '../ide/editor/core'
import { useDistractionFree } from '../ide/workbench/distractionFree'
import { EditorArea } from '../ide/workbench/EditorArea'
import { OverlayHost } from '../ide/workbench/OverlayHost'
import { StatusBar } from '../ide/workbench/StatusBar'
import { TitleBar } from '../ide/workbench/TitleBar'
import { ToolWindowLayout } from '../ide/workbench/toolwindows/ToolWindows'
import styles from '../ide/workbench/Workbench.module.css'
import { useProject } from '../ide/platform/project'
import { ProgressBar } from '../ide/ui'
import { appLogo as projectMark } from '../assets/appLogo'
import { useSelectedWorkspace } from '../platform/workspaceStore'

import { PaneQuickStartHost } from './sessions/PaneQuickStartHost'
import { SessionCloseConfirmHost } from './sessions/SessionCloseConfirmHost'
import { startSessionTabsReconciler } from './sessions/sessionTabsReconciler'
import './titlebar/titleBarLayout.css'
import { useAppearanceFlag, useNavigationBarPosition } from './workbenchChrome'
import { WorkbenchBanners } from './WorkbenchBanners'

/**
 * Shown while the backend opens the selected workspace, like the IDE's project opening view: the
 * bare title bar (menu and window controls only) over a progress bar. The shell below stays mounted
 * (and inert), so the terminals keep running.
 */
function WorkspaceOpening({ path }: { path: string }) {
  const workspace = useSelectedWorkspace()
  const name = workspace?.name ?? path
  const label = `Opening ${name}`
  return (
    <div className={styles.opening} data-project-opening>
      <TitleBar bare />
      <div className={styles.openingBody} role="status" aria-label={label}>
        <div className={styles.openingBrand} aria-hidden="true">
          <img className={styles.openingLogo} src={projectMark} alt="" draggable={false} />
          <span>OmniTerm</span>
        </div>
        <ProgressBar className={styles.openingProgress} aria-label={label} />
        <div className={styles.openingTitle}>{label}</div>
        <div className={styles.openingPath} title={path}>
          {path}
        </div>
      </div>
    </div>
  )
}

/**
 * The IDE workbench shell: the IDE title bar (main menu, workspace widget, branch, run, search,
 * gear, window controls), tool windows around the editor area, status bar and overlay layer. Each
 * session is an editor tab.
 */
export function WorkbenchShell() {
  // One editor tab per session, kept in step with the window's sessions.
  useEffect(() => startSessionTabsReconciler(), [])
  const openingPath = useProject((s) => s.openingPath)
  const distractionFree = useDistractionFree((s) => s.active)
  const mainToolbar = useAppearanceFlag('showMainToolbar')
  const statusBar = useAppearanceFlag('showStatusBar')
  const navBarPosition = useNavigationBarPosition()
  return (
    <div className={`${styles.workbench} ${styles.framed}`} data-workbench>
      <div className={styles.content} inert={openingPath !== null}>
        <TitleBar compact={distractionFree || !mainToolbar} />
        {!distractionFree && navBarPosition === 'top' && <Breadcrumbs className={styles.navigationBar} />}
        <WorkbenchBanners />
        <ToolWindowLayout editor={<EditorArea />} />
        {!distractionFree && statusBar && <StatusBar />}
      </div>
      {openingPath && <WorkspaceOpening path={openingPath} />}
      <OverlayHost />
      <SessionCloseConfirmHost />
      <PaneQuickStartHost />
    </div>
  )
}
