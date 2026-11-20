import { leadSelection } from '../../ide/features/project-tree/store'
import { useProject } from '../../ide/platform/project'
import { toolWindowService } from '../../ide/workbench/contributions'
import type { MenuItem } from '../../ide/ui'
import type { ShellOption } from '../../shellOptions'
import { selectedWorkspaceId, useWorkspaceStore } from '../../platform/workspaceStore'
import { currentDefaultProject, useProjectFilterStore } from '../projectFilterStore'

import { dockSession, endedDocked, expectDockedSession } from './terminalDockStore'

/** Id of OmniTerm's bottom Terminal tool window. */
export const TERMINAL_WINDOW = 'omniterm.terminal'

const inside = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`)

/**
 * Where a new terminal starts: the project the Project panel is filtered to, else the workspace
 * project holding the tree's selection, else the project folder. A workspace of several projects
 * opens as a container folder under the app's data directory, which is never the answer: its
 * default project is (the first one until one is chosen), when nothing is selected.
 */
export function terminalStartFolder(): string | undefined {
  const filter = useProjectFilterStore.getState().filter
  if (filter !== 'all') return filter
  const project = useProject.getState().project
  if (!project) return undefined
  const members = project.workspace?.projects ?? []
  if (members.length === 0 || members.includes(project.root)) return project.root
  const selected = leadSelection()?.path
  const holding = selected ? members.filter((member) => inside(selected, member)) : []
  // The innermost project when one contains another.
  return holding.sort((a, b) => b.length - a.length)[0] ?? currentDefaultProject(members) ?? members[0]
}

/**
 * Starts a local shell that opens in the Terminal tool window: `shell` (an id of
 * `loadShellOptions`, as IDEA's "New Terminal ⌄" offers), else the user's default, in `folder`, else
 * in {@link terminalStartFolder}. The session is
 * docked when it shows up on the session bridge. Anything but a string (a click event, an action
 * argument) picks the default.
 */
export function requestDockedTerminal(shell?: unknown, folder?: string): void {
  expectDockedSession()
  const cwd = folder ?? terminalStartFolder()
  const chosen = typeof shell === 'string' && shell ? shell : undefined
  const detail = cwd || chosen ? { ...(cwd ? { cwd } : {}), ...(chosen ? { shell: chosen } : {}) } : null
  window.dispatchEvent(new CustomEvent('omniterm:new-session', { detail }))
  toolWindowService().show(TERMINAL_WINDOW)
}

/**
 * Before a stored agent session is resumed: when the session it continues ran in the Terminal tool
 * window, the new one is docked there too (and the window shown) rather than opened as a tab.
 */
export function resumeWhereItRan(previousSessionId: string | undefined): void {
  if (!previousSessionId || !endedDocked(previousSessionId)) return
  expectDockedSession()
  toolWindowService().show(TERMINAL_WINDOW)
}

/** Moves a session from its editor tab into the Terminal tool window (its tab closes, it keeps running). */
export function moveSessionToTerminalWindow(sessionId: string): void {
  dockSession(sessionId)
  toolWindowService().show(TERMINAL_WINDOW)
}

/** The menu items of "New Terminal ⌄": one per shell this machine can start, as IDEA lists them. */
export function shellMenuItems(options: readonly ShellOption[], open: (shell: string) => void = requestDockedTerminal) {
  return options.map((option) => ({ label: option.label, icon: 'terminal', verbatim: true, run: () => open(option.id) }))
}

const folderName = (path: string): string => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path

/**
 * The projects a terminal can start in: the selected workspace's folders that are switched on (what
 * the user arranged and sees), else the folders of the open IDE project.
 */
export function terminalProjects(): string[] {
  const state = useWorkspaceStore.getState()
  const id = selectedWorkspaceId(state.selection)
  const workspace = state.workspaces.find((item) => item.id === id)
  const fromCatalog = (workspace?.folders ?? []).filter((folder) => !folder.disabled).map((folder) => folder.path)
  return fromCatalog.length > 0 ? fromCatalog : (useProject.getState().project?.workspace?.projects ?? [])
}

/**
 * The "New Terminal ⌄" rows that pick the project of a workspace with several: one per project, its
 * shells in a submenu. The project a plain "+" would use is checked.
 */
export function projectMenuItems(
  options: readonly ShellOption[],
  open: (shell: string, folder: string) => void = requestDockedTerminal,
): MenuItem[] {
  const members = terminalProjects()
  if (members.length < 2) return []
  const current = terminalStartFolder()
  const norm = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  const same = (a: string, b: string | undefined) => !!b && norm(a) === norm(b)
  return [
    { kind: 'separator' },
    { kind: 'header', label: 'Open in Project' },
    ...members.map((folder): MenuItem => ({
      label: folderName(folder),
      verbatim: true,
      icon: 'folder',
      checked: same(folder, current),
      submenu: shellMenuItems(options, (shell) => open(shell, folder)),
    })),
  ]
}
