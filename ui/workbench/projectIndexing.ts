import type { Workspace } from '../domain'
import { basename } from '../ide/platform/project'
import { notifications } from '../ide/workbench/contributions'
import { confirm } from '../ide/workbench/messages'
import { defaultFolder, indexedFolders, isIndexed, markIndexed } from '../platform/indexScope'
import { syncProject } from '../platform/projectBridge'
import { selectedWorkspaceId, useWorkspaceStore } from '../platform/workspaceStore'

/**
 * Adds the project at `path` to what the index of `workspace` covers. When `workspace` is the open
 * one, the backend applies the new scope right away and indexes the project in the background.
 * Resolves false when the project was already indexed (nothing changed).
 */
export async function indexWorkspaceProject(workspace: Workspace, path: string): Promise<boolean> {
  if (!markIndexed(workspace, path)) return false
  if (selectedWorkspaceId(useWorkspaceStore.getState().selection) === workspace.id) await syncProject(workspace.id, { quiet: true })
  return true
}

/** Projects the user declined to index this session; asked again after a restart. */
const declined = new Set<string>()

/**
 * After the project at `path` became the default of `workspace`: asks whether to index it when it
 * is not indexed yet.
 */
export async function offerToIndexDefault(workspace: Workspace, path: string): Promise<void> {
  const key = `${workspace.id}\n${path}`
  if (isIndexed(workspace, path) || declined.has(key)) return
  const name = basename(path)
  const yes = await confirm({
    title: 'Index Project?',
    message: `"${name}" is not indexed yet. Index it now so search, navigation and code insight cover it? Indexing runs in the background and can be stopped from its task.`,
    ok: 'Index',
    icon: 'question',
  })
  if (yes) await indexWorkspaceProject(workspace, path)
  else declined.add(key)
}

/** Workspaces whose "not indexed" notification was shown this session. */
const offeredOnOpen = new Set<string>()

/**
 * When `workspace` opens with no project indexed (nothing is indexed on its own), a notification
 * offers to index its default project. Not Now (or closing it) leaves it until the next start.
 */
export function offerToIndexOnOpen(workspace: Workspace): void {
  const path = defaultFolder(workspace)
  if (!path || indexedFolders(workspace).length > 0 || offeredOnOpen.has(workspace.id)) return
  offeredOnOpen.add(workspace.id)
  const key = `index-on-open-${workspace.id}`
  const close = () => notifications().remove?.(key)
  notifications().notify({
    level: 'info',
    title: 'Project not indexed',
    body: `"${basename(path)}" is not indexed, so search, navigation and code insight do not cover it yet. Indexing runs in the background and can be stopped from its task.`,
    key,
    sticky: true,
    actions: [
      {
        label: 'Index',
        run: () => {
          close()
          void indexWorkspaceProject(workspace, path)
        },
      },
      {
        label: 'Not Now',
        run: () => {
          close()
          declined.add(`${workspace.id}\n${path}`)
        },
      },
    ],
  })
}
