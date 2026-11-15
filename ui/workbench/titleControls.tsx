import { provideProjectPopup, registerTitleItem } from '../ide/workbench/contributions'

import { ProjectFilterItem } from './titlebar/ProjectFilterItem'
import { WorkspacePopup } from './titlebar/WorkspacePopup'
import { UpdateTitleIndicator } from './updater/updateIndicator'

/**
 * OmniTerm's own pieces of the upstream title bar:
 * - the project widget's popup lists workspaces (OmniTerm's "project") instead of recent projects;
 * - the "All projects" filter sits right after the project widget, before the branch widget;
 * - the update indicator, after Search Everywhere, while an update is available;
 *
 * The title bar carries no font size or zoom control (the mock has none): the terminal zoom shortcuts,
 * each pane's own control and Settings cover them.
 */
export function registerTitleControls(): () => void {
  const disposers = [
    provideProjectPopup(WorkspacePopup),
    registerTitleItem({
      id: 'omniterm.projectFilter',
      title: 'Project Filter',
      align: 'left',
      priority: 5,
      component: ProjectFilterItem,
    }),
    registerTitleItem({
      id: 'omniterm.update',
      title: 'Update Indicator',
      align: 'right',
      priority: 0,
      trailing: true,
      component: UpdateTitleIndicator,
    }),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
