import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useTabs } from '../../ide/editor/core/controller'
import { initialTabsState, openTab, paneIds } from '../../ide/editor/core/model/tabs'
import { useProject } from '../../ide/platform/project'
import {
  applyEditorPreset,
  currentPreset,
  isMaximized,
  maximizeActivePane,
  parseStoredPresets,
  projectKey,
  restoreMaximized,
} from '../layout/layoutPresetStore'
import { sessionInput } from '../sessions/sessionInput'

function seed(count: number) {
  let state = initialTabsState()
  for (let i = 0; i < count; i++) state = openTab(state, state.activePane, sessionInput(`s${i}`), { preview: false }).state
  useTabs.setState(state, true)
}

beforeEach(() => {
  useProject.setState({ opening: false })
  seed(4)
})

afterEach(() => {
  if (isMaximized()) restoreMaximized()
  useProject.setState({ opening: false })
})

describe('layout preset store', () => {
  it('applies a preset to the editor', () => {
    expect(applyEditorPreset('2x2')).toBe(true)
    expect(currentPreset()).toBe('2x2')
    expect(paneIds(useTabs.getState())).toHaveLength(4)
  })

  it('never changes the layout while a project is opening', () => {
    useProject.setState({ opening: true })
    const before = useTabs.getState()
    expect(applyEditorPreset('2x2')).toBe(false)
    expect(useTabs.getState()).toBe(before)
  })

  it('maximizes the active pane and restores the layout and the tabs of every pane', () => {
    applyEditorPreset('2x2')
    const layout = paneIds(useTabs.getState()).map((id) => useTabs.getState().panes[id]!.tabs.map((tab) => tab.input.key))
    expect(maximizeActivePane()).toBe(true)
    expect(isMaximized()).toBe(true)
    expect(paneIds(useTabs.getState())).toHaveLength(1)
    expect(restoreMaximized()).toBe(true)
    expect(isMaximized()).toBe(false)
    expect(currentPreset()).toBe('2x2')
    expect(paneIds(useTabs.getState()).map((id) => useTabs.getState().panes[id]!.tabs.map((tab) => tab.input.key))).toEqual(layout)
  })

  it('has nothing to maximize in a single pane', () => {
    expect(maximizeActivePane()).toBe(false)
  })

  it('keys projects by a hash, not by the folder path', () => {
    expect(projectKey('D:/work/app')).not.toContain('work')
    expect(projectKey('D:/work/app')).toBe(projectKey('D:/work/app'))
    expect(projectKey('D:/work/app')).not.toBe(projectKey('D:/work/other'))
  })

  it('drops invalid stored presets', () => {
    expect(parseStoredPresets({ abc: '2x2', def: 'huge', ghi: 4 })).toEqual({ abc: '2x2' })
    expect(parseStoredPresets('x')).toEqual({})
  })
})
