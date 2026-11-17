import { executeAction, registerAction } from '../ide/platform/actions'
import { dirname } from '../ide/platform/project'
import { isVirtualUri } from '../ide/platform/virtualDocs'
import { registerMenuGroup } from '../ide/workbench/contributions'
import { useWorkspaceStore } from '../platform/workspaceStore'

import { useProjectFilterStore } from './projectFilterStore'
import { removeFolderFromWorkspace, workspaceFolderAt } from './titlebar/workspaceActions'

/**
 * Registers project tree actions for OmniTerm:
 * - `omniterm.workspace.removeFolder`: removes the selected project folder from the workspace
 * - `omniterm.workspace.setDefaultProject`: where the workspace's new terminals and agents start
 * - an "Open in Terminal" entry in the editor and editor tab menus
 * - `terminal.openAt`: opens a terminal session in the folder via `omniterm:new-session`
 * - `p5.tree.toolbar.locate`: alias executing `navigate.selectInProjectView`
 */
export function registerProjectTreeActions(): () => void {
  const disposers = [
    registerAction({
      id: 'terminal.openAt',
      title: 'Open in Terminal',
      category: 'Terminal',
      description: 'Open a new terminal session at the selected folder',
      icon: 'terminal',
      run: ({ arg }) => {
        const cwd = typeof arg === 'string'
          ? arg
          : (arg && typeof arg === 'object' && 'cwd' in arg && typeof (arg as { cwd: unknown }).cwd === 'string'
              ? (arg as { cwd: string }).cwd
              : undefined)
        window.dispatchEvent(new CustomEvent('omniterm:new-session', { detail: { cwd } }))
      },
    }),
    registerAction({
      id: 'omniterm.workspace.removeFolder',
      title: 'Remove from Workspace',
      category: 'Project',
      description: 'Take the selected project folder out of the workspace; its files stay on disk',
      icon: 'close',
      run: ({ arg }) => {
        if (typeof arg !== 'string') return
        const owner = useWorkspaceStore.getState().workspaces.find((workspace) => workspaceFolderAt(workspace, arg))
        const folder = workspaceFolderAt(owner, arg)
        if (owner && folder) void removeFolderFromWorkspace(owner.id, folder)
      },
    }),
    registerAction({
      id: 'omniterm.workspace.setDefaultProject',
      title: 'Set as Default Project',
      category: 'Project',
      description: 'New terminals and agents of this workspace start in the selected project',
      run: ({ arg }) => {
        if (typeof arg !== 'string') return
        const owner = useWorkspaceStore.getState().workspaces.find((workspace) => workspaceFolderAt(workspace, arg))
        const folder = workspaceFolderAt(owner, arg)
        if (owner && folder) useProjectFilterStore.getState().setDefaultProject(owner.id, folder.path)
      },
    }),
    // The editor and its tab: a terminal in the folder of the file.
    registerMenuGroup({
      id: 'omniterm.terminal.openAtFile',
      menus: ['editor', 'editorTab'],
      order: 85,
      items: (_menu, { paths }) => {
        const path = paths.length === 1 ? paths[0] : undefined
        return path && !isVirtualUri(path)
          ? [{ kind: 'action', action: 'terminal.openAt', label: 'Open in Terminal', icon: 'terminal', arg: dirname(path) }]
          : []
      },
    }),
    registerAction({
      id: 'p5.tree.toolbar.locate',
      title: 'Select Opened File',
      category: 'Navigate',
      description: 'Scroll the project tree to the active editor file',
      icon: 'locate',
      run: ({ arg }) => {
        void executeAction('navigate.selectInProjectView', arg)
      },
    }),
  ]

  return () => {
    disposers.reverse().forEach((dispose) => dispose())
  }
}
