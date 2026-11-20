import type { Workspace } from '../domain'
import { executeAction, registerAction } from '../ide/platform/actions'
import { call, commands } from '../ide/platform/ipc'
import { dirname } from '../ide/platform/project'
import { isVirtualUri } from '../ide/platform/virtualDocs'
import { notifications, registerMenuGroup } from '../ide/workbench/contributions'
import { defaultFolder } from '../platform/indexScope'
import { selectedWorkspaceId, useWorkspaceStore } from '../platform/workspaceStore'

import { comparablePath, useProjectFilterStore } from './projectFilterStore'
import { indexWorkspaceProject, offerToIndexDefault } from './projectIndexing'
import { removeFolderFromWorkspace, workspaceFolderAt } from './titlebar/workspaceActions'

/**
 * Registers project tree actions for OmniTerm:
 * - `omniterm.workspace.removeFolder`: removes the selected project folder from the workspace
 * - `omniterm.workspace.setDefaultProject`: where the workspace's new terminals and agents start
 * - an "Open in Terminal" entry in the editor and editor tab menus
 * - `terminal.openAt`: opens a terminal session in the folder via `omniterm:new-session`
 * - `omniterm.project.index`: indexes the whole project (right-click a folder › Index Project); in a
 *   multi-project workspace it first adds the folder's project to what the index covers
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
      id: 'omniterm.project.index',
      title: 'Index Project',
      category: 'Project',
      description: 'Index every file and symbol of the project now, so search finds them',
      icon: 'refresh',
      run: ({ arg }) => indexProject(typeof arg === 'string' ? arg : undefined),
    }),
    // Right-click a folder of the project tree: the index covers the whole project, not one folder.
    registerMenuGroup({
      id: 'omniterm.project.index',
      menus: ['projectView'],
      order: 330,
      items: (_menu, { paths, dirs }) =>
        paths.length === 1 && dirs?.[0]
          ? [
              { kind: 'action', action: 'omniterm.project.index', label: 'Index Project', icon: 'refresh', arg: paths[0] },
              { kind: 'separator' },
            ]
          : [],
    }),
    registerAction({
      id: 'omniterm.workspace.removeFolder',
      title: 'Remove from Workspace',
      category: 'Project',
      description: 'Take the selected project folder out of the workspace; its files stay on disk',
      icon: 'close',
      run: ({ arg }) => {
        if (typeof arg !== 'string') return
        const owner = ownerWorkspaceOf(arg)
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
        const owner = ownerWorkspaceOf(arg)
        const folder = workspaceFolderAt(owner, arg)
        if (!owner || !folder) return
        useProjectFilterStore.getState().setDefaultProject(owner.id, folder.path)
        void offerToIndexDefault(owner, folder.path)
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

/**
 * The workspace a project tree folder belongs to: the selected one, whose tree is shown. The same
 * folder may sit in several workspaces, and the first of those in the catalog is often another one,
 * so acting on it there changed nothing the user could see.
 */
function ownerWorkspaceOf(path: string): Workspace | undefined {
  const { workspaces, selection } = useWorkspaceStore.getState()
  const selectedId = selectedWorkspaceId(selection)
  const selected = workspaces.find((workspace) => workspace.id === selectedId)
  if (selected && workspaceFolderAt(selected, path)) return selected
  return workspaces.find((workspace) => workspaceFolderAt(workspace, path))
}

/** The selected workspace (undefined without one). */
function selectedWorkspace(): Workspace | undefined {
  const { selection, workspaces } = useWorkspaceStore.getState()
  const workspaceId = selectedWorkspaceId(selection)
  return workspaces.find((item) => item.id === workspaceId)
}

/**
 * The workspace project folder holding `path` (itself or a folder inside it), with its workspace;
 * without a path, the default project of the selected workspace.
 */
function projectFolderOf(path: string | undefined): { workspace: Workspace; folder: string } | null {
  const workspace = selectedWorkspace()
  if (!workspace) return null
  if (path === undefined) {
    const folder = defaultFolder(workspace)
    return folder ? { workspace, folder } : null
  }
  const target = comparablePath(path)
  const folder = workspace?.folders.find((item) => {
    const root = comparablePath(item.path)
    return target === root || target.startsWith(`${root}/`)
  })
  return workspace && folder ? { workspace, folder: folder.path } : null
}

/**
 * Starts indexing the whole project in the background and says so (or why it could not). Nothing
 * is indexed until the user chooses a project, so the project holding `path` (without one, the
 * default project) joins what the index covers first.
 */
export async function indexProject(path?: string): Promise<void> {
  try {
    const owner = projectFolderOf(path)
    const added = owner !== null && (await indexWorkspaceProject(owner.workspace, owner.folder))
    // A project that just joined the index is scanned by the scope change; otherwise rescan.
    if (!added) await call(commands.indexProject())
    notifications().notify({ level: 'info', title: 'Indexing the project…', key: 'omniterm.project.index' })
  } catch (error) {
    notifications().notify({
      level: 'error',
      title: 'Could not index the project',
      body: error instanceof Error ? error.message : String(error),
      key: 'omniterm.project.index',
    })
  }
}
