import { openFileLink } from '../ide/features/terminal/openFile'
import { useProject } from '../ide/platform/project'

import type { TerminalPathLink } from './createTerminalContextMenu'

/**
 * Open a path a session pane printed (`src/x.ts:12:5`, `.bizreq/outbox/task.md`) in the editor.
 * Relative paths resolve against the pane's directory first, then the open project, so an agent
 * that reports project-relative paths after a `cd` still lands on the file.
 */
export const openTerminalPath = (link: TerminalPathLink, cwd: string | null): Promise<boolean> =>
  openFileLink(
    { path: link.text, line: link.line, col: link.col },
    cwd ?? '',
    [useProject.getState().project?.root ?? ''],
  )
