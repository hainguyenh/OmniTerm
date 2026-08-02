/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry } from '@omniterm/contract'
import { DEFAULT_TREE_FILTER, type TreeFilter } from '../../utils/workspaceFilter'
import { useTreeReveal, type RevealRequest } from '../useTreeReveal'

const target: WorkspaceEntry = {
  id: 'docs/nested/readme.txt',
  name: 'readme.txt',
  path: 'C:/ws/docs/nested/readme.txt',
  isDir: false,
  kind: 'txt',
  viewable: true,
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(ok => { resolve = ok })
  return { promise, resolve }
}

function setup(initialRequest: RevealRequest | null = null, filter: TreeFilter = DEFAULT_TREE_FILTER) {
  const scan = vi.fn().mockResolvedValue(undefined)
  const loadFolder = vi.fn().mockResolvedValue(undefined)
  const entriesOf = vi.fn().mockReturnValue([target])
  const filterOf = vi.fn().mockReturnValue(filter)
  const setExpandedId = vi.fn()
  const setFlatView = vi.fn()
  const setExpandedDirs = vi.fn()
  const setFilters = vi.fn()
  const props = {
    revealRequest: initialRequest,
    entriesOf,
    scan,
    loadFolder,
    filterOf,
    setExpandedId,
    setFlatView,
    setExpandedDirs,
    setFilters,
  }
  const hook = renderHook(
    ({ revealRequest }: { revealRequest: RevealRequest | null }) => useTreeReveal({ ...props, revealRequest }),
    { initialProps: { revealRequest: initialRequest as RevealRequest | null } },
  )
  return { ...hook, props }
}

describe('useTreeReveal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does nothing without a reveal request', () => {
    const { result, props } = setup()
    expect(result.current.isHighlighted('ws', target.id)).toBe(false)
    expect(props.scan).not.toHaveBeenCalled()
  })

  it('expands and loads every ancestor, widens a hiding filter, scrolls, then clears the flash', async () => {
    const { result, rerender, props } = setup()
    const row = document.createElement('div')
    const scrollIntoView = vi.spyOn(row, 'scrollIntoView')
    act(() => result.current.registerRow('ws', target.id)(row))

    rerender({ revealRequest: { workspaceId: 'ws', path: target.id, nonce: 1 } })
    await vi.runAllTimersAsync()
    await waitFor(() => expect(result.current.isHighlighted('ws', target.id)).toBe(true))

    expect(props.setExpandedId).toHaveBeenCalledWith('ws')
    expect(props.scan).toHaveBeenCalledWith('ws')
    expect(props.setFlatView).toHaveBeenCalledWith(false)
    expect(props.loadFolder.mock.calls).toEqual([
      ['ws', 'docs'],
      ['ws', 'docs/nested'],
    ])
    const expand = props.setExpandedDirs.mock.calls[0][0] as (prev: Set<string>) => Set<string>
    expect([...expand(new Set(['keep']))]).toEqual(['keep', 'ws:docs', 'ws:docs/nested'])
    const updateFilter = props.setFilters.mock.calls[0][0] as (
      prev: Record<string, TreeFilter>,
    ) => Record<string, TreeFilter>
    expect(updateFilter({ other: DEFAULT_TREE_FILTER }).ws).toEqual({ ...DEFAULT_TREE_FILTER, mode: 'all' })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })

    act(() => { vi.advanceTimersByTime(1600) })
    expect(result.current.isHighlighted('ws', target.id)).toBe(false)
  })

  it('keeps a filter that already shows the target and supports repeated nonces', async () => {
    const all: TreeFilter = { ...DEFAULT_TREE_FILTER, mode: 'all' }
    const { result, rerender, props } = setup(null, all)

    rerender({ revealRequest: { workspaceId: 'ws', path: target.id, nonce: 1 } })
    await waitFor(() => expect(result.current.isHighlighted('ws', target.id)).toBe(true))
    expect(props.setFilters).not.toHaveBeenCalled()

    rerender({ revealRequest: { workspaceId: 'ws', path: target.id, nonce: 2 } })
    await waitFor(() => expect(props.scan).toHaveBeenCalledTimes(2))
  })

  it('does not widen the filter when the requested entry no longer exists', async () => {
    const { result, rerender, props } = setup()
    props.entriesOf.mockReturnValue([])

    rerender({ revealRequest: { workspaceId: 'ws', path: 'gone.txt', nonce: 1 } })
    await waitFor(() => expect(result.current.isHighlighted('ws', 'gone.txt')).toBe(true))
    expect(props.setFilters).not.toHaveBeenCalled()
  })

  it('cancels after a slow workspace scan when the request changes', async () => {
    const gate = deferred()
    const { rerender, props } = setup()
    props.scan.mockReturnValue(gate.promise)

    rerender({ revealRequest: { workspaceId: 'ws', path: target.id, nonce: 1 } })
    rerender({ revealRequest: null })
    await act(async () => {
      gate.resolve()
      await gate.promise
    })

    expect(props.setExpandedId).toHaveBeenCalledWith('ws')
    expect(props.setFlatView).not.toHaveBeenCalled()
    expect(props.loadFolder).not.toHaveBeenCalled()
  })

  it('cancels between ancestor loads and never highlights the stale request', async () => {
    const gate = deferred()
    const { result, rerender, props } = setup()
    props.loadFolder.mockImplementationOnce(() => gate.promise)

    rerender({ revealRequest: { workspaceId: 'ws', path: target.id, nonce: 1 } })
    await waitFor(() => expect(props.loadFolder).toHaveBeenCalledWith('ws', 'docs'))
    rerender({ revealRequest: null })
    await act(async () => {
      gate.resolve()
      await gate.promise
    })

    expect(props.loadFolder).toHaveBeenCalledTimes(1)
    expect(result.current.isHighlighted('ws', target.id)).toBe(false)
  })

  it('unregisters a row so a later reveal does not try to scroll a dead element', async () => {
    const { result, rerender } = setup()
    const row = document.createElement('div')
    const scrollIntoView = vi.spyOn(row, 'scrollIntoView')
    const register = result.current.registerRow('ws', target.id)
    act(() => {
      register(row)
      register(null)
    })

    rerender({ revealRequest: { workspaceId: 'ws', path: target.id, nonce: 1 } })
    await waitFor(() => expect(result.current.isHighlighted('ws', target.id)).toBe(true))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
