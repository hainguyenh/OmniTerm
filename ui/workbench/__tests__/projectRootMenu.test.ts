/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'

import type { MenuItem } from '../../ide/ui'

import { contextMenuItems } from '../../ide/features/project-tree/contextMenu'
import type { ProjectNode } from '../../ide/features/project-tree/model'
import { setRootToggles } from '../../ide/features/project-tree/rootToggle'
import { useProject } from '../../ide/platform/project'

const noop = () => undefined
const actions = { toggle: noop, setDefault: noop, clearDefault: noop, openTerminal: noop }

const root = (path: string) => ({ key: path, path, label: path.slice(1), root: true, dir: true }) as unknown as ProjectNode

const actionIds = (items: MenuItem[]): string[] =>
  items.flatMap((item) => ('action' in item && typeof item.action === 'string' ? [item.action] : []))

describe('project root context menu', () => {
  afterEach(() => {
    setRootToggles(new Map(), null)
    useProject.setState({ project: null })
  })

  it('offers Set as Default only on a project that is not the default yet', () => {
    useProject.setState({ project: { root: '/w', workspace: { projects: ['/a', '/b'] } } } as never)
    setRootToggles(new Map([['/a', true], ['/b', true]]), actions, '/a')

    expect(actionIds(contextMenuItems([root('/a')]))).not.toContain('omniterm.workspace.setDefaultProject')
    expect(actionIds(contextMenuItems([root('/a')]))).toContain('omniterm.workspace.removeFolder')
    expect(actionIds(contextMenuItems([root('/b')]))).toContain('omniterm.workspace.setDefaultProject')
  })
})
