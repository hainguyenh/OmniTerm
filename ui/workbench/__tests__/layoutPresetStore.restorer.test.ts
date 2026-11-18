/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { diag } from '../../diag'
import { useTabs } from '../../ide/editor/core/controller'
import { initialTabsState, openTab } from '../../ide/editor/core/model/tabs'
import { useProject } from '../../ide/platform/project'
import {
  applyEditorPreset,
  currentPreset,
  isMaximized,
  maximizeActivePane,
  projectKey,
  restoreMaximized,
  startPresetRestorer,
  storedPreset,
  subscribeMaximized,
} from '../layout/layoutPresetStore'
import * as presets from '../layout/layoutPresets'
import { sessionInput } from '../sessions/sessionInput'

const STORAGE_KEY = 'omniterm.layoutPreset.v1'

function seed(count: number) {
  let state = initialTabsState()
  for (let i = 0; i < count; i++) state = openTab(state, state.activePane, sessionInput(`s${i}`), { preview: false }).state
  useTabs.setState(state, true)
}

function setRoot(root: string | null, extra: Record<string, unknown> = {}) {
  useProject.setState({ project: root === null ? null : ({ root } as never), opening: false, ...extra } as never)
}

beforeEach(() => {
  localStorage.clear()
  setRoot('C:/proj-a', { lightEdit: false })
  useTabs.setState(initialTabsState(), true)
})

afterEach(() => {
  if (isMaximized()) restoreMaximized()
  vi.restoreAllMocks()
  setRoot(null, { lightEdit: false })
})

describe('project key and stored presets', () => {
  it('names no project "none" and hashes a root to a short key', () => {
    expect(projectKey(null)).toBe('none')
    expect(projectKey('C:/a')).toMatch(/^[0-9a-f]{1,8}$/)
    expect(projectKey('C:/a')).not.toBe(projectKey('C:/b'))
  })

  it('remembers the preset per project in storage', () => {
    seed(4)
    expect(storedPreset()).toBeNull()
    applyEditorPreset('2x2')
    expect(storedPreset()).toBe('2x2')
    setRoot('C:/proj-b')
    expect(storedPreset()).toBeNull()
    setRoot(null, { lightEdit: true })
    applyEditorPreset('2')
    expect(storedPreset()).toBe('2')
    expect(storedPreset(projectKey('lightedit'))).toBe('2')
    setRoot(null, { lightEdit: false })
    expect(storedPreset()).toBeNull()
    expect(storedPreset(projectKey(null))).toBeNull()
  })

  it('ignores unreadable or corrupt storage', () => {
    localStorage.setItem(STORAGE_KEY, 'not json')
    expect(storedPreset()).toBeNull()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [projectKey('C:/proj-a')]: 'bogus' }))
    expect(storedPreset()).toBeNull()
  })

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    seed(2)
    expect(applyEditorPreset('2')).toBe(true)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(storedPreset()).toBeNull()
  })
})

describe('maximize notifications', () => {
  it('notifies subscribers and stops after unsubscribe', () => {
    seed(4)
    applyEditorPreset('2x2')
    const listener = vi.fn()
    const stop = subscribeMaximized(listener)
    expect(maximizeActivePane()).toBe(true)
    expect(maximizeActivePane()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(restoreMaximized()).toBe(true)
    expect(restoreMaximized()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    maximizeActivePane()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('refuses to maximize a single pane or while a project opens', () => {
    seed(1)
    expect(maximizeActivePane()).toBe(false)
    seed(4)
    applyEditorPreset('2x2')
    useProject.setState({ opening: true })
    expect(maximizeActivePane()).toBe(false)
    useProject.setState({ opening: false })
    maximizeActivePane()
    useProject.setState({ opening: true })
    expect(restoreMaximized()).toBe(false)
  })

  it('ends a maximize when another layout is chosen', () => {
    seed(4)
    applyEditorPreset('2x2')
    maximizeActivePane()
    const listener = vi.fn()
    subscribeMaximized(listener)
    applyEditorPreset('2x2')
    expect(isMaximized()).toBe(false)
    expect(listener).toHaveBeenCalled()
  })

  it('does not restore the old panes into another project', () => {
    seed(4)
    applyEditorPreset('2x2')
    maximizeActivePane()
    const single = useTabs.getState()
    setRoot('C:/proj-b')
    expect(restoreMaximized()).toBe(true)
    expect(useTabs.getState()).toBe(single)
  })
})

describe('startPresetRestorer', () => {
  it('brings back the remembered preset once the tabs were restored', () => {
    seed(4)
    applyEditorPreset('2x2')
    useTabs.setState(initialTabsState(), true)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [projectKey('C:/proj-a')]: '2x2' }))
    const stop = startPresetRestorer()
    expect(currentPreset()).not.toBe('2x2')
    seed(4)
    expect(currentPreset()).toBe('2x2')
    stop()
  })

  it('leaves a layout that is not a preset alone', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [projectKey('C:/proj-a')]: '2x2' }))
    const spy = vi.spyOn(presets, 'detectPreset').mockReturnValue('custom')
    const stop = startPresetRestorer()
    seed(2)
    expect(spy).toHaveBeenCalled()
    stop()
  })

  it('does nothing while a project is opening, then waits for the next project', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [projectKey('C:/proj-b')]: '2x2' }))
    useProject.setState({ opening: true })
    const stop = startPresetRestorer()
    seed(4)
    expect(currentPreset()).not.toBe('2x2')
    setRoot('C:/proj-b')
    expect(currentPreset()).toBe('2x2')
    stop()
  })

  it('ends a maximize when the project changes', () => {
    seed(4)
    applyEditorPreset('2x2')
    maximizeActivePane()
    const stop = startPresetRestorer()
    setRoot('C:/proj-c')
    expect(isMaximized()).toBe(false)
    stop()
  })

  it('logs and carries on when applying the preset fails', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [projectKey('C:/proj-a')]: '2x2' }))
    const stop = startPresetRestorer()
    const warn = vi.spyOn(diag, 'warn').mockImplementation(() => {})
    vi.spyOn(presets, 'applyPreset').mockImplementation(() => { throw new Error('bad layout') })
    seed(4)
    expect(warn).toHaveBeenCalledWith('[layout] could not bring back the layout preset', expect.any(Error))
    stop()
  })

  it('stops reacting once disposed', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [projectKey('C:/proj-a')]: '2x2' }))
    startPresetRestorer()()
    seed(4)
    expect(currentPreset()).not.toBe('2x2')
  })
})
