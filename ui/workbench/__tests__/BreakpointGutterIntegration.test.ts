/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ide/platform/ipc', () => ({
  call: vi.fn(() => Promise.resolve([])),
  commands: {
    debugSetBreakpoints: vi.fn(),
    debugBreakpointStates: vi.fn(),
  },
  isTauri: vi.fn(() => false),
}))

import {
  addBreakpoint,
  breakpointsOf,
  consumeTemporary,
  loadBreakpoints,
  removeAllBreakpoints,
  removeBreakpoint,
  setMuted,
  toggleBreakpoint,
  toggleTemporaryBreakpoint,
  updateBreakpoint,
  useBreakpoints,
} from '../../ide/features/debugger/breakpoints/store'
import { toBackend } from '../../ide/features/debugger/breakpoints/model'

describe('BreakpointGutterIntegration (Feature 33)', () => {
  const fileA = '/workspace/src/app.rs'
  const fileB = '/workspace/src/lib.rs'

  beforeEach(() => {
    localStorage.clear()
    removeAllBreakpoints()
    setMuted(false)
  })

  it('toggles line breakpoints on and off', () => {
    expect(breakpointsOf(fileA)).toEqual([])

    // First toggle: adds breakpoint at line 12
    toggleBreakpoint(fileA, 12)
    const list1 = breakpointsOf(fileA)
    expect(list1).toHaveLength(1)
    expect(list1[0]?.line).toBe(12)
    expect(list1[0]?.enabled).toBe(true)

    // Second toggle at same line: removes breakpoint
    toggleBreakpoint(fileA, 12)
    expect(breakpointsOf(fileA)).toEqual([])
  })

  it('adds and updates conditional breakpoints with hit counts', () => {
    const bp = addBreakpoint(fileA, 20, {
      condition: 'count > 100',
      hitCondition: '>= 5',
      logMessage: 'Reached threshold',
    })

    expect(bp.line).toBe(20)
    expect(bp.condition).toBe('count > 100')
    expect(bp.hitCondition).toBe('>= 5')
    expect(bp.logMessage).toBe('Reached threshold')

    // Update condition
    updateBreakpoint(fileA, bp.id, {
      condition: 'count > 200',
      hitCondition: '>= 10',
    })

    const updated = breakpointsOf(fileA).find((b) => b.id === bp.id)
    expect(updated?.condition).toBe('count > 200')
    expect(updated?.hitCondition).toBe('>= 10')
  })

  it('handles temporary (one-shot) breakpoints and consumes them on hit', () => {
    toggleTemporaryBreakpoint(fileA, 30)
    const list = breakpointsOf(fileA)
    expect(list).toHaveLength(1)
    expect(list[0]?.line).toBe(30)
    expect(list[0]?.temporary).toBe(true)

    // Simulate suspension at line 30: temporary breakpoint is consumed
    const consumed = consumeTemporary(fileA, 30)
    expect(consumed).toBe(true)
    expect(breakpointsOf(fileA)).toEqual([])

    // Consuming non-existent temporary breakpoint returns false
    expect(consumeTemporary(fileA, 30)).toBe(false)
  })

  it('mutes and unmutes breakpoints across the project', () => {
    addBreakpoint(fileA, 5)
    addBreakpoint(fileB, 10)

    expect(useBreakpoints.getState().muted).toBe(false)
    setMuted(true)
    expect(useBreakpoints.getState().muted).toBe(true)

    // When serialized for DAP backend, muted state turns enabled to false
    const backendItems = toBackend(breakpointsOf(fileA), true, fileA)
    expect(backendItems[0]?.enabled).toBe(false)

    setMuted(false)
    expect(useBreakpoints.getState().muted).toBe(false)
  })

  it('maintains multiple files and clears all breakpoints cleanly', () => {
    addBreakpoint(fileA, 1)
    addBreakpoint(fileA, 2)
    addBreakpoint(fileB, 3)

    expect(breakpointsOf(fileA)).toHaveLength(2)
    expect(breakpointsOf(fileB)).toHaveLength(1)

    removeBreakpoint(fileA, breakpointsOf(fileA)[0]!.id)
    expect(breakpointsOf(fileA)).toHaveLength(1)

    removeAllBreakpoints()
    expect(breakpointsOf(fileA)).toHaveLength(0)
    expect(breakpointsOf(fileB)).toHaveLength(0)
  })

  it('persists and isolates breakpoints per project root confinement', () => {
    const root1 = '/workspace/project-alpha'
    const root2 = '/workspace/project-beta'

    // Load project alpha, set a breakpoint
    loadBreakpoints(root1)
    addBreakpoint(`${root1}/src/main.rs`, 10)
    expect(breakpointsOf(`${root1}/src/main.rs`)).toHaveLength(1)

    // Switch to project beta: alpha breakpoints are not present
    loadBreakpoints(root2)
    expect(breakpointsOf(`${root1}/src/main.rs`)).toHaveLength(0)
    addBreakpoint(`${root2}/src/lib.rs`, 20)
    expect(breakpointsOf(`${root2}/src/lib.rs`)).toHaveLength(1)

    // Switch back to project alpha: alpha breakpoints restored from storage
    loadBreakpoints(root1)
    expect(breakpointsOf(`${root1}/src/main.rs`)).toHaveLength(1)
    expect(breakpointsOf(`${root2}/src/lib.rs`)).toHaveLength(0)
  })
})
