import { openFileLink } from '../ide/features/terminal/openFile'
import { useProject } from '../ide/platform/project'
import { selectedWorkspaceId, useWorkspaceStore } from '../platform/workspaceStore'

import type { TerminalPathLink } from './createTerminalContextMenu'

/**
 * The folders a relative path printed in a session pane may be relative to, after the pane's own
 * directory: the open project, then the selected workspace's projects, then every other
 * workspace's. An agent prints paths relative to the project it works in, which need not be the
 * one the editor has open, nor where its shell started.
 */
export const projectRoots = (): string[] => {
  const { workspaces, selection } = useWorkspaceStore.getState()
  const selected = selectedWorkspaceId(selection)
  const ordered = [
    ...workspaces.filter((workspace) => workspace.id === selected),
    ...workspaces.filter((workspace) => workspace.id !== selected),
  ]
  const folders = ordered.flatMap((workspace) => workspace.folders.filter((folder) => !folder.disabled).map((folder) => folder.path))
  return [...new Set([useProject.getState().project?.root ?? '', ...folders].filter(Boolean))]
}

/**
 * Open a path a session pane printed (`src/x.ts:12:5`, `.bizreq/outbox/task.md`) in the editor.
 * Relative paths resolve against the pane's directory first, then the projects, so an agent that
 * reports project-relative paths after a `cd` still lands on the file.
 */
export const openTerminalPath = (link: TerminalPathLink, cwd: string | null): Promise<boolean> =>
  openFileLink(
    { path: link.text, line: link.line, col: link.col, candidates: link.candidates },
    cwd ?? '',
    projectRoots(),
  )
