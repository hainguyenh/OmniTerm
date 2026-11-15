import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Tab = { id: string; input: { key: string } }
type Pane = { id: string; tabs: Tab[] }

const state = vi.hoisted(() => {
  const listeners = new Set<(s: unknown) => void>()
  return {
    listeners,
    tabs: { panes: {} as Record<string, Pane> },
    order: [] as string[],
    applyPreset: vi.fn(),
    openFile: vi.fn(),
    moveTab: vi.fn(),
    activate: vi.fn(),
    warn: vi.fn(),
  }
})

vi.mock('../../../diag', () => ({ diag: { warn: (...args: unknown[]) => state.warn(...args), error: vi.fn(), log: vi.fn(), info: vi.fn() } }))
vi.mock('../../../ide/editor/core/controller', () => ({
  fileKey: (path: string) => `file:${path}`,
  useTabs: {
    getState: () => state.tabs,
    subscribe: (cb: (s: unknown) => void) => {
      state.listeners.add(cb)
      return () => state.listeners.delete(cb)
    },
  },
  editorController: () => ({ openFile: state.openFile, moveTab: state.moveTab, activate: state.activate }),
}))
vi.mock('../../../ide/editor/core/model/tabs', () => ({
  paneIds: () => state.order,
  findTab: (s: { panes: Record<string, Pane> }, key: string) => {
    for (const pane of Object.values(s.panes)) {
      const tab = pane.tabs.find((item) => item.input.key === key)
      if (tab) return { paneId: pane.id, tab }
    }
    return null
  },
}))
vi.mock('../../../hooks/useScriptRuns', () => ({ editorTabId: (path: string) => `editor#${path}` }))
vi.mock('../../layout/layoutPresetStore', () => ({ applyEditorPreset: (...args: unknown[]) => state.applyPreset(...args) }))
vi.mock('../sessionInput', () => ({ sessionInput: (id: string) => ({ key: `session:${id}` }) }))

import { isScriptFileOpen, openScriptFile, pairRunWithFile, scriptPathOf } from '../scriptRunLayout'

function layout(panes: Pane[]) {
  state.tabs = { panes: Object.fromEntries(panes.map((pane) => [pane.id, pane])) }
  state.order = panes.map((pane) => pane.id)
}

describe('scriptPathOf / isScriptFileOpen', () => {
  beforeEach(() => layout([{ id: 'p1', tabs: [{ id: 't', input: { key: 'file:C:/s/a.sh' } }] }]))

  it('extracts the file path of a script editor id', () => {
    expect(scriptPathOf('editor#C:/s/a.sh')).toBe('C:/s/a.sh')
    expect(scriptPathOf('editor#')).toBeNull()
    expect(scriptPathOf('other#x')).toBeNull()
  })

  it('knows whether the file is open in some pane', () => {
    expect(isScriptFileOpen('editor#C:/s/a.sh')).toBe(true)
    expect(isScriptFileOpen('editor#C:/s/b.sh')).toBe(false)
    expect(isScriptFileOpen('nope')).toBe(false)
  })
})

describe('openScriptFile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens the file focused and logs a failure', async () => {
    state.openFile.mockResolvedValueOnce(undefined)
    openScriptFile('C:/a.sh')
    expect(state.openFile).toHaveBeenCalledWith('C:/a.sh', { focus: true })
    state.openFile.mockRejectedValueOnce(new Error('gone'))
    openScriptFile('C:/b.sh')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state.warn).toHaveBeenCalledWith('[scripts] could not open the file', expect.any(Error))
  })
})

describe('pairRunWithFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.listeners.clear()
    state.openFile.mockResolvedValue(undefined)
    state.applyPreset.mockReturnValue(true)
  })
  afterEach(() => vi.useRealTimers())

  const session = { id: 'ts', input: { key: 'session:s1' } }

  it('does nothing for an id that is not a script', async () => {
    layout([{ id: 'p1', tabs: [] }])
    await pairRunWithFile('s1', 'nope')
    expect(state.openFile).not.toHaveBeenCalled()
  })

  it('stops when a second pane cannot be made', async () => {
    layout([{ id: 'p1', tabs: [] }])
    state.applyPreset.mockReturnValue(false)
    await pairRunWithFile('s1', 'editor#C:/a.sh')
    expect(state.applyPreset).toHaveBeenCalledWith('2')
    expect(state.openFile).not.toHaveBeenCalled()
  })

  it('stops when the panes are still not two after the preset', async () => {
    layout([{ id: 'p1', tabs: [] }])
    await pairRunWithFile('s1', 'editor#C:/a.sh')
    expect(state.openFile).not.toHaveBeenCalled()
  })

  it('opens the file in the first pane and moves the session tab to the second', async () => {
    layout([{ id: 'p1', tabs: [] }, { id: 'p2', tabs: [{ id: 'x', input: { key: 'file:b' } }] }, { id: 'p3', tabs: [session] }])
    await pairRunWithFile('s1', 'editor#C:/a.sh')
    expect(state.openFile).toHaveBeenCalledWith('C:/a.sh', { pane: 'p1', focus: false })
    expect(state.moveTab).toHaveBeenCalledWith('p3', 'ts', 'p2', 1)
    expect(state.activate).toHaveBeenCalledWith('p2', 'ts')
  })

  it('only activates a session tab that is already in the second pane', async () => {
    layout([{ id: 'p1', tabs: [] }, { id: 'p2', tabs: [session] }])
    await pairRunWithFile('s1', 'editor#C:/a.sh')
    expect(state.moveTab).not.toHaveBeenCalled()
    expect(state.activate).toHaveBeenCalledWith('p2', 'ts')
  })

  it('waits for a session tab that arrives late', async () => {
    layout([{ id: 'p1', tabs: [] }, { id: 'p2', tabs: [] }])
    const done = pairRunWithFile('s1', 'editor#C:/a.sh')
    await Promise.resolve()
    await Promise.resolve()
    state.tabs.panes.p2!.tabs.push(session)
    state.listeners.forEach((listener) => listener(state.tabs))
    await done
    expect(state.activate).toHaveBeenCalledWith('p2', 'ts')
    expect(state.listeners.size).toBe(0)
  })

  it('gives up when the session tab never shows up', async () => {
    vi.useFakeTimers()
    layout([{ id: 'p1', tabs: [] }, { id: 'p2', tabs: [] }])
    const done = pairRunWithFile('s1', 'editor#C:/a.sh')
    await vi.advanceTimersByTimeAsync(10_001)
    await done
    expect(state.activate).not.toHaveBeenCalled()
    expect(state.listeners.size).toBe(0)
  })
})
