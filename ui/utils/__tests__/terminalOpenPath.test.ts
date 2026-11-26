import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProject } from '../../ide/platform/project'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { projectRoots } from '../terminalOpenPath'

import type { Workspace } from '../../domain'

vi.mock('../../ide/features/terminal/openFile', () => ({ openFileLink: vi.fn() }))

const workspace = (id: string, folders: Array<{ path: string; disabled?: boolean }>): Workspace => ({
  id,
  name: id,
  order: 0,
  pins: [],
  folders: folders.map((folder, i) => ({ id: `${id}-${i}`, name: folder.path, ...folder })),
})

describe('the folders a session pane path resolves against', () => {
  beforeEach(() => {
    useProject.setState({ project: null })
  })

  // Regression: a path relative to a workspace project the editor did not have open was "not found".
  it('lists the open project, then the selected workspace, then the other workspaces', () => {
    useProject.setState({ project: { root: 'D:/work/app' } as never })
    useWorkspaceStore.setState({
      selection: 'b',
      workspaces: [
        workspace('a', [{ path: 'D:/work/other' }]),
        workspace('b', [{ path: 'D:/work/tests' }, { path: 'D:/work/app' }, { path: 'D:/work/off', disabled: true }]),
      ],
    })
    expect(projectRoots()).toEqual(['D:/work/app', 'D:/work/tests', 'D:/work/other'])
  })
})
