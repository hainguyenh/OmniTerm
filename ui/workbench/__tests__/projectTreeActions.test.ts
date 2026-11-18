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
import { menuGroupItems } from '../../ide/workbench/contributions'
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

  it('disposes all registered actions cleanly', () => {
    expect(getAction('terminal.openAt')).toBeDefined()
    expect(getAction('p5.tree.toolbar.locate')).toBeDefined()

    dispose?.()
    dispose = null

    expect(getAction('terminal.openAt')).toBeUndefined()
    expect(getAction('p5.tree.toolbar.locate')).toBeUndefined()
  })
})
