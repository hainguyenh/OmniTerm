import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ide/workbench/activate', () => ({ activateWorkbench: vi.fn() }))
vi.mock('../../ide/editor/core', () => ({ activate: vi.fn() }))
vi.mock('../../ide/editor/lsp', () => ({ activate: vi.fn() }))
vi.mock('../../ide/features/project-tree', () => ({ activate: vi.fn() }))
vi.mock('../../ide/features/run', () => ({ activate: vi.fn() }))
vi.mock('../../ide/features/search', () => ({ activate: vi.fn() }))
vi.mock('../../ide/features/vcs', () => ({ activate: vi.fn() }))
vi.mock('../../ide/features/debugger', () => ({ activate: vi.fn() }))
vi.mock('../../ide/platform/keymap', () => ({ installKeyboardDispatcher: vi.fn() }))

import {
  activateWorkbenchFeatures,
  DEFERRED_WORKBENCH_STEPS,
  WORKBENCH_STEPS,
  type ScheduleIdle,
} from '../activateWorkbenchFeatures'

/** Collects scheduled idle tasks so a test can run them one at a time. */
function manualSchedule() {
  const queue: Array<() => void> = []
  const schedule: ScheduleIdle = (task) => {
    queue.push(task)
    return () => {
      const index = queue.indexOf(task)
      if (index >= 0) queue.splice(index, 1)
    }
  }
  return { queue, schedule }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('activateWorkbenchFeatures', () => {
  const releases: Array<() => void> = []
  afterEach(() => {
    while (releases.length) releases.pop()?.()
  })

  it('lists the shell first and the keyboard dispatcher last', () => {
    const names = WORKBENCH_STEPS.map(([name]) => name)
    expect(names[0]).toBe('shell')
    expect(names.at(-1)).toBe('keyboard')
    expect(names).toEqual(
      expect.arrayContaining(['editor', 'lsp', 'project-tree', 'session-tabs', 'terminal-tool-window', 'agents', 'vcs']),
    )
  })

  it('starts the project folder, terminals and agent sessions at launch and the rest once idle', () => {
    const eager = WORKBENCH_STEPS.map(([name]) => name)
    const deferred = DEFERRED_WORKBENCH_STEPS.map(([name]) => name)
    for (const name of ['project-tree', 'session-tabs', 'terminal-tool-window', 'shell-tool-windows', 'agents']) {
      expect(eager).toContain(name)
    }
    for (const name of ['lsp-workbench', 'code-insight', 'search', 'mcp', 'run', 'debugger', 'build', 'templates', 'tools', 'web', 'updater']) {
      expect(deferred).toContain(name)
    }
  })

  it('defers an OmniTerm adapter right behind the feature whose tool window it replaces', () => {
    const deferred = DEFERRED_WORKBENCH_STEPS.map(([name]) => name)
    expect(deferred.indexOf('run-workbench')).toBe(deferred.indexOf('run') + 1)
    expect(deferred.indexOf('debugger-workbench')).toBe(deferred.indexOf('debugger') + 1)
  })

  it('mounts the coding, git, run, plugin, remote and agent features OmniTerm ports', () => {
    const names = [...WORKBENCH_STEPS, ...DEFERRED_WORKBENCH_STEPS].map(([name]) => name)
    expect(names).toEqual(
      expect.arrayContaining([
        'project-trust', 'code-insight', 'dotnet', 'web', 'viewers', 'tools',
        'settings', 'omniterm-settings', 'plugins', 'ssh', 'remote-dev', 'agents', 'github', 'app',
      ]),
    )
  })

  it('defers only the features whose contributions may arrive after the shell paints', () => {
    const eager = WORKBENCH_STEPS.map(([name]) => name)
    const deferred = DEFERRED_WORKBENCH_STEPS.map(([name]) => name)
    expect(deferred).toEqual(expect.arrayContaining(['todo', 'scratch', 'libraries', 'analysis', 'github', 'ssh']))
    // Restorable editor kinds must exist before the session is saved or restored.
    for (const name of ['editor', 'session-tabs', 'agents', 'plugins', 'vcs', 'viewers']) {
      expect(eager).toContain(name)
    }
    expect(eager.filter((name) => deferred.includes(name))).toEqual([])
  })

  it('leaves out the features OmniTerm replaces or does not ship', () => {
    const names = WORKBENCH_STEPS.map(([name]) => name)
    // OmniTerm's own sessions are the terminal and its workspaces pick the project; the rest is
    // JVM, Android, notebooks and API clients.
    for (const name of ['terminal', 'welcome', 'profiler', 'logcat', 'notebook', 'http-client', 'graphql', 'build-tools']) {
      expect(names).not.toContain(name)
      expect(DEFERRED_WORKBENCH_STEPS.map(([deferred]) => deferred)).not.toContain(name)
    }
  })

  it('activates the language features right after the editor core they extend', () => {
    const names = WORKBENCH_STEPS.map(([name]) => name)
    expect(names.indexOf('lsp')).toBe(names.indexOf('editor') + 1)
  })

  it('activates in order and disposes in reverse when the last user releases', () => {
    const log: string[] = []
    const steps = [
      ['a', () => { log.push('+a'); return () => { log.push('-a') } }],
      ['b', () => { log.push('+b'); return () => { log.push('-b') } }],
    ] as const
    const release = activateWorkbenchFeatures(steps)
    const releaseAgain = activateWorkbenchFeatures(steps)
    expect(log).toEqual(['+a', '+b'])
    release()
    expect(log).toEqual(['+a', '+b'])
    releaseAgain()
    releaseAgain()
    expect(log).toEqual(['+a', '+b', '-b', '-a'])
  })

  it('keeps going when one feature throws on activation', () => {
    const later = vi.fn()
    const release = activateWorkbenchFeatures([
      ['broken', () => { throw new Error('boom') }],
      ['fine', later],
    ])
    releases.push(release)
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('keeps disposing when one disposer throws', () => {
    const first = vi.fn()
    const release = activateWorkbenchFeatures([
      ['first', () => first],
      ['second', () => () => { throw new Error('boom') }],
    ])
    release()
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('loads the deferred features one idle period at a time, after the eager ones', async () => {
    const log: string[] = []
    const { queue, schedule } = manualSchedule()
    const deferred = [
      ['x', async () => () => { log.push('+x'); return () => { log.push('-x') } }],
      ['y', async () => () => { log.push('+y'); return () => { log.push('-y') } }],
    ] as const
    const release = activateWorkbenchFeatures(
      [['a', () => { log.push('+a'); return () => { log.push('-a') } }]],
      deferred,
      schedule,
    )
    expect(log).toEqual(['+a'])
    expect(queue).toHaveLength(1)
    queue.shift()?.()
    await flush()
    expect(log).toEqual(['+a', '+x'])
    expect(queue).toHaveLength(1)
    queue.shift()?.()
    await flush()
    expect(log).toEqual(['+a', '+x', '+y'])
    expect(queue).toHaveLength(0)
    release()
    expect(log).toEqual(['+a', '+x', '+y', '-y', '-x', '-a'])
  })

  it('stops loading deferred features once the workbench is released', async () => {
    const later = vi.fn()
    const { queue, schedule } = manualSchedule()
    const release = activateWorkbenchFeatures([], [['late', async () => later]], schedule)
    release()
    expect(queue).toHaveLength(0)
    expect(later).not.toHaveBeenCalled()
  })

  it('skips a deferred feature whose load finishes after the release', async () => {
    const later = vi.fn()
    const { queue, schedule } = manualSchedule()
    const release = activateWorkbenchFeatures([], [['late', async () => later]], schedule)
    queue.shift()?.()
    release()
    await flush()
    expect(later).not.toHaveBeenCalled()
  })

  it('keeps loading the next deferred feature when one fails to load', async () => {
    const later = vi.fn()
    const { queue, schedule } = manualSchedule()
    const release = activateWorkbenchFeatures(
      [],
      [
        ['broken', () => Promise.reject(new Error('chunk'))],
        ['fine', async () => later],
      ],
      schedule,
    )
    releases.push(release)
    queue.shift()?.()
    await flush()
    queue.shift()?.()
    await flush()
    expect(later).toHaveBeenCalledTimes(1)
  })
})
