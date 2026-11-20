/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  executeAction,
  getAction,
  registerAction,
} from '../../ide/platform/actions'
const indexProjectMock = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => vi.fn())
vi.mock('../../ide/platform/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ide/platform/ipc')>()),
  call: (result: Promise<unknown>) => result,
  commands: { indexProject: () => indexProjectMock() },
}))
vi.mock('../../ide/workbench/contributions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ide/workbench/contributions')>()),
  notifications: () => ({ notify }),
}))
const indexWorkspaceProject = vi.hoisted(() => vi.fn())
const offerToIndexDefault = vi.hoisted(() => vi.fn())
vi.mock('../projectIndexing', () => ({ indexWorkspaceProject, offerToIndexDefault }))
import { menuGroupItems } from '../../ide/workbench/contributions'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { useProjectFilterStore } from '../projectFilterStore'
import { registerProjectTreeActions } from '../projectTreeActions'

describe('projectTreeActions', () => {
  let dispose: (() => void) | null = null

  beforeEach(() => {
    dispose = registerProjectTreeActions()
  })

  afterEach(() => {
    if (dispose) {
      dispose()
      dispose = null
    }
  })

  it('registers terminal.openAt and dispatches omniterm:new-session on run', () => {
    const action = getAction('terminal.openAt')
    expect(action).toBeDefined()
    expect(action?.title).toBe('Open in Terminal')

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    // Run with string argument
    void action?.run({ ctx: {}, arg: '/test/workspace/folder' })

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    const event = dispatchSpy.mock.calls[0]![0] as CustomEvent<{ cwd?: string }>
    expect(event.type).toBe('omniterm:new-session')
    expect(event.detail?.cwd).toBe('/test/workspace/folder')

    // Run with object argument
    void action?.run({ ctx: {}, arg: { cwd: '/another/folder' } })
    const secondEvent = dispatchSpy.mock.calls[1]![0] as CustomEvent<{ cwd?: string }>
    expect(secondEvent.detail?.cwd).toBe('/another/folder')

    dispatchSpy.mockRestore()
  })

  it('offers Index Project on a folder of the project tree and starts the index', async () => {
    const items = menuGroupItems('projectView', { paths: ['/work/app'], dirs: [true] })
    expect(items).toContainEqual(expect.objectContaining({ action: 'omniterm.project.index', label: 'Index Project' }))
    expect(menuGroupItems('projectView', { paths: ['/work/app/a.ts'], dirs: [false] })).not.toContainEqual(
      expect.objectContaining({ action: 'omniterm.project.index' }),
    )
    indexProjectMock.mockResolvedValue(null)
    await executeAction('omniterm.project.index')
    expect(indexProjectMock).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }))
  })

  it('reports why indexing could not start', async () => {
    indexProjectMock.mockRejectedValue(new Error('Project is in Restricted Mode'))
    await executeAction('omniterm.project.index')
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', body: 'Project is in Restricted Mode' }))
  })

  it('registers p5.tree.toolbar.locate and executes navigate.selectInProjectView', async () => {
    const action = getAction('p5.tree.toolbar.locate')
    expect(action).toBeDefined()
    expect(action?.title).toBe('Select Opened File')

    const mockSelect = vi.fn()
    const unregisterMock = registerAction({
      id: 'navigate.selectInProjectView',
      title: 'Select In Project View',
      run: (c) => mockSelect(c.arg),
    })

    try {
      await executeAction('p5.tree.toolbar.locate', '/file/to/locate.ts')
      expect(mockSelect).toHaveBeenCalledWith('/file/to/locate.ts')
    } finally {
      unregisterMock()
    }
  })

  // Regression: with the same folder in several workspaces, "Set as Default Project" wrote the
  // default of the first workspace in the catalog, not the selected one the tree shows.
  it('sets the default project of the selected workspace when the folder is in several', async () => {
    const folders = [{ id: 'a', name: 'a', path: 'D:/work/a' }, { id: 'b', name: 'b', path: 'D:/work/b' }]
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'other', name: 'other', order: 0, pins: [], folders },
        { id: 'shown', name: 'shown', order: 1, pins: [], folders },
      ],
      selection: 'shown',
    } as never)
    useProjectFilterStore.setState({ defaults: {} })

    await executeAction('omniterm.workspace.setDefaultProject', 'D:\\work\\b')

    expect(useProjectFilterStore.getState().defaults).toEqual({ shown: 'D:/work/b' })
    expect(offerToIndexDefault).toHaveBeenCalledWith(expect.objectContaining({ id: 'shown' }), 'D:/work/b')
  })

  it('adds the project of a folder to the index before indexing a multi-project workspace', async () => {
    const folders = [{ id: 'a', name: 'a', path: 'D:/work/a' }, { id: 'b', name: 'b', path: 'D:/work/b' }]
    useWorkspaceStore.setState({ workspaces: [{ id: 'ws', name: 'ws', order: 0, pins: [], folders }], selection: 'ws' } as never)
    indexProjectMock.mockReset()
    indexProjectMock.mockResolvedValue(null)

    // A project that just joined the index is scanned by the scope change alone.
    indexWorkspaceProject.mockResolvedValueOnce(true)
    await executeAction('omniterm.project.index', 'D:\\work\\b\\src')
    expect(indexWorkspaceProject).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'ws' }), 'D:/work/b')
    expect(indexProjectMock).not.toHaveBeenCalled()

    // An indexed project is rescanned.
    indexWorkspaceProject.mockResolvedValueOnce(false)
    await executeAction('omniterm.project.index', 'D:/work/b')
    expect(indexProjectMock).toHaveBeenCalledTimes(1)
  })

  // Regression: Index Project in a one-folder workspace (or from Find Action, without a folder)
  // indexed without recording the choice, so the next project sync held the index again.
  it('records the project before indexing a one-folder workspace, the default one without a folder', async () => {
    const folders = [{ id: 'solo', name: 'solo', path: 'D:/work/solo' }]
    useWorkspaceStore.setState({ workspaces: [{ id: 'one', name: 'one', order: 0, pins: [], folders }], selection: 'one' } as never)
    indexWorkspaceProject.mockReset()
    indexWorkspaceProject.mockResolvedValue(true)

    await executeAction('omniterm.project.index', 'D:/work/solo/src')
    expect(indexWorkspaceProject).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'one' }), 'D:/work/solo')

    await executeAction('omniterm.project.index')
    expect(indexWorkspaceProject).toHaveBeenCalledTimes(2)
    expect(indexWorkspaceProject).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'one' }), 'D:/work/solo')
  })

  it('disposes all registered actions cleanly', () => {
    expect(getAction('terminal.openAt')).toBeDefined()
    expect(getAction('p5.tree.toolbar.locate')).toBeDefined()

    dispose?.()
    dispose = null

    expect(getAction('terminal.openAt')).toBeUndefined()
    expect(getAction('p5.tree.toolbar.locate')).toBeUndefined()
  })
})
