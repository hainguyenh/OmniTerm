/**
 * @vitest-environment jsdom
 */
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_VIEW_OPTIONS,
  currentModel,
  initProjectTree,
  setViewOption,
  showsContributedRoot,
  useProjectTree,
} from '../../ide/features/project-tree/store'
import { registerProjectViewRoot } from '../../ide/workbench/contributions'

describe('External Libraries and Scratches in the Project view', () => {
  let disposers: Array<() => void> = []

  beforeEach(() => {
    act(() => {
      initProjectTree('/repo')
      useProjectTree.setState({ mode: 'project', options: { ...DEFAULT_VIEW_OPTIONS } })
    })
    disposers = [
      registerProjectViewRoot({ id: 'externalLibraries', label: 'External Libraries', icon: 'library', order: 5, children: [] }),
      registerProjectViewRoot({ id: 'scratches', label: 'Scratches', icon: 'scratches', path: '/data/scratches', order: 10 }),
      registerProjectViewRoot({ id: 'connections', label: 'Connections', icon: 'web', order: 20, leaf: true }),
    ]
  })

  afterEach(() => {
    disposers.forEach((dispose) => dispose())
    act(() => initProjectTree(null))
  })

  const labels = () => currentModel().roots.map((node) => node.label)

  it('hides both by default and keeps other contributed roots', () => {
    expect(DEFAULT_VIEW_OPTIONS.showExternalLibraries).toBe(false)
    expect(DEFAULT_VIEW_OPTIONS.showScratches).toBe(false)
    expect(labels()).not.toContain('External Libraries')
    expect(labels()).not.toContain('Scratches')
    expect(labels()).toContain('Connections')
  })

  it('lists each again once its view option is switched on', () => {
    act(() => setViewOption('showExternalLibraries', true))
    expect(labels()).toContain('External Libraries')
    expect(labels()).not.toContain('Scratches')
    act(() => setViewOption('showScratches', true))
    expect(labels()).toContain('Scratches')
  })

  it('decides by contribution id', () => {
    const off = { showExternalLibraries: false, showScratches: false }
    expect(showsContributedRoot('externalLibraries', off)).toBe(false)
    expect(showsContributedRoot('scratches', off)).toBe(false)
    expect(showsContributedRoot('anything', off)).toBe(true)
  })
})
