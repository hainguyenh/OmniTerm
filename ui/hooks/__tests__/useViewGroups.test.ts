/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import type { LayoutMode } from '../../themes'
import { useViewGroups } from '../useViewGroups'
import { DEFAULT_VIEW_GROUP_ID } from '../../viewGroups'

function useHarness() {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(1)
  const [panes, setPanes] = useState<(string | null)[]>(Array(8).fill(null))
  const [focusedPane, setFocusedPane] = useState(0)
  const groups = useViewGroups({ layoutMode, setLayoutMode, panes, setPanes, focusedPane, setFocusedPane })
  return { ...groups, layoutMode, setLayoutMode, panes, setPanes }
}

describe('useViewGroups', () => {
  it('always exposes a default group for tabs without an explicit group', () => {
    const { result } = renderHook(() => useHarness())
    expect(result.current.viewGroups[0]).toMatchObject({ id: DEFAULT_VIEW_GROUP_ID, label: 'Ungrouped', persistent: true })
    expect(result.current.activeGroupId).toBe(DEFAULT_VIEW_GROUP_ID)
  })

  it('creates and selects an explicit group when multi-view starts from the default group', () => {
    const { result } = renderHook(() => useHarness())
    act(() => {
      result.current.setPanes(['new-tab', ...Array(7).fill(null)])
      result.current.setLayoutMode(2)
    })

    const explicit = result.current.viewGroups.find(group => group.id !== DEFAULT_VIEW_GROUP_ID)
    expect(explicit?.panes[0]).toBe('new-tab')
    expect(result.current.activeGroupId).toBe(explicit?.id)
  })

  it('groups many existing tabs atomically without duplicating or dropping panes', () => {
    const tabs = Array.from({ length: 8 }, (_, index) => `tab-${index + 1}`)
    const { result } = renderHook(() => useHarness())

    act(() => {
      result.current.setPanes(tabs)
      result.current.setLayoutMode(8)
    })

    const explicitGroups = result.current.viewGroups.filter(group => group.id !== DEFAULT_VIEW_GROUP_ID)
    expect(explicitGroups).toHaveLength(1)
    expect(result.current.viewGroups.at(-1)?.id).toBe(DEFAULT_VIEW_GROUP_ID)
    expect(result.current.activeGroupId).toBe(explicitGroups[0].id)
    expect(explicitGroups[0].panes).toEqual(tabs)
    expect(Object.keys(result.current.tabGroups)).toHaveLength(tabs.length)
    expect(new Set(Object.keys(result.current.tabGroups))).toEqual(new Set(tabs))
  })

  it('does not reset the selected multi-view group when expanding an under-filled layout', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.createNewViewGroup('first-tab', false))
    const groupId = result.current.viewGroups.find(group => group.id !== DEFAULT_VIEW_GROUP_ID)?.id ?? ''
    act(() => result.current.switchViewGroup(groupId))
    act(() => {
      result.current.setPanes(['first-tab', null, ...Array(6).fill(null)])
      result.current.setLayoutMode(2)
    })
    act(() => result.current.setLayoutMode(4))

    expect(result.current.activeGroupId).toBe(groupId)
    expect(result.current.layoutMode).toBe(4)
    expect(result.current.panes[0]).toBe('first-tab')
    expect(result.current.viewGroups.some(group => group.id === groupId)).toBe(true)
  })

  it('removes an auto-created group after its tab docks into the active group', () => {
    const { result } = renderHook(() => useHarness())
    act(() => { result.current.createNewViewGroup('existing-tab', false) })
    const activeId = result.current.viewGroups.find(group => group.id !== DEFAULT_VIEW_GROUP_ID)?.id ?? ''
    act(() => { result.current.switchViewGroup(activeId) })
    act(() => { result.current.createNewViewGroup('overflow-tab', false) })
    expect(result.current.viewGroups).toHaveLength(3)

    act(() => { result.current.setPanes(['overflow-tab', ...Array(7).fill(null)]) })

    expect(result.current.viewGroups).toHaveLength(2)
    expect(result.current.viewGroups.find(group => group.id === activeId)?.panes[0]).toBe('overflow-tab')
    expect(result.current.tabGroups).toEqual({ 'overflow-tab': activeId })
  })

  it('stores the active layout size on its group', () => {
    const { result } = renderHook(() => useHarness())
    act(() => { result.current.createNewViewGroup('tab', false) })
    act(() => { result.current.switchViewGroup(result.current.viewGroups[0].id); result.current.setLayoutMode(6) })

    const active = result.current.viewGroups.find(group => group.id === result.current.activeGroupId)
    expect(active?.layoutMode).toBe(6)
  })

  it('reorders groups without changing their saved state', () => {
    const { result } = renderHook(() => useHarness())
    act(() => { result.current.createNewViewGroup('first', false); result.current.createNewViewGroup('second', false) })
    const explicitIds = result.current.viewGroups.filter(group => group.id !== DEFAULT_VIEW_GROUP_ID).map(group => group.id)
    const firstId = explicitIds[0]
    const secondId = explicitIds[1]
    act(() => window.dispatchEvent(new CustomEvent('omniterm:reorder-view-groups', { detail: { sourceId: secondId, targetId: firstId, before: true } })))

    expect(result.current.viewGroups.map(group => group.id)).toEqual([secondId, firstId, DEFAULT_VIEW_GROUP_ID])
  })

  it('merges a standalone pane back into its existing group when multi-view returns', () => {
    const { result } = renderHook(() => useHarness())
    act(() => { result.current.createNewViewGroup('left-tab', false) })
    const groupId = result.current.viewGroups.find(group => group.id !== DEFAULT_VIEW_GROUP_ID)?.id ?? ''
    act(() => { result.current.createNewViewGroup(undefined, true) })
    act(() => { result.current.setPanes(['left-tab', ...Array(7).fill(null)]); result.current.setLayoutMode(2) })

    expect(result.current.activeGroupId).toBe(groupId)
  })

  it('keeps a named or colored group and removes it only when explicitly ungrouped', () => {
    const { result } = renderHook(() => useHarness())
    act(() => { result.current.createNewViewGroup('tab', false) })
    const groupId = result.current.viewGroups.find(group => group.id !== DEFAULT_VIEW_GROUP_ID)?.id ?? ''
    act(() => window.dispatchEvent(new CustomEvent('omniterm:update-view-group', { detail: { groupId, patch: { label: 'Pinned' } } })))
    expect(result.current.viewGroups.find(group => group.id === groupId)).toMatchObject({ label: 'Pinned', persistent: true })
    act(() => { result.current.setPanes(Array(8).fill(null)) })
    expect(result.current.viewGroups).toHaveLength(2)
    act(() => window.dispatchEvent(new CustomEvent('omniterm:ungroup-view-group', { detail: { groupId } })))
    expect(result.current.viewGroups).toHaveLength(1)
  })

  it('persists rename and color together, then returns its tabs to Ungrouped on ungroup', () => {
    const { result } = renderHook(() => useHarness())
    act(() => {
      result.current.createNewViewGroup('first-tab', false)
    })
    const groupId = result.current.viewGroups.find(group => group.panes.includes('first-tab'))?.id ?? ''
    act(() => result.current.switchViewGroup(groupId))
    act(() => result.current.setPanes(['first-tab', ...Array(7).fill(null)]))
    act(() => window.dispatchEvent(new CustomEvent('omniterm:update-view-group', {
      detail: { groupId, patch: { label: 'Pinned', color: '#34d399' } },
    })))

    expect(result.current.viewGroups.find(group => group.id === groupId)).toMatchObject({
      label: 'Pinned', color: '#34d399', persistent: true,
    })
    act(() => window.dispatchEvent(new CustomEvent('omniterm:ungroup-view-group', { detail: { groupId } })))

    expect(result.current.activeGroupId).toBe(DEFAULT_VIEW_GROUP_ID)
    expect(result.current.layoutMode).toBe(1)
    expect(result.current.panes[0]).toBe('first-tab')
    expect(result.current.tabGroups).toEqual({})
    expect(result.current.viewGroups.map(group => group.id)).toEqual([DEFAULT_VIEW_GROUP_ID])
  })

  it('removes an empty uncustomized group after its last tab is removed', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.createNewViewGroup('temporary-tab', false))
    const groupId = result.current.viewGroups.find(group => group.panes.includes('temporary-tab'))?.id ?? ''
    act(() => result.current.switchViewGroup(groupId))
    act(() => result.current.setPanes(Array(8).fill(null)))

    expect(result.current.viewGroups.map(group => group.id)).toEqual([DEFAULT_VIEW_GROUP_ID])
    expect(result.current.tabGroups).toEqual({})
  })

  it('ungroups an inactive group without changing the active group panes', () => {
    const { result } = renderHook(() => useHarness())
    act(() => {
      result.current.createNewViewGroup('active-tab', false)
      result.current.createNewViewGroup('inactive-tab', false)
    })
    const explicit = result.current.viewGroups.filter(group => group.id !== DEFAULT_VIEW_GROUP_ID)
    const activeId = explicit[0].id
    const inactiveId = explicit[1].id
    act(() => result.current.switchViewGroup(activeId))
    act(() => result.current.setPanes(['active-tab', ...Array(7).fill(null)]))
    act(() => window.dispatchEvent(new CustomEvent('omniterm:ungroup-view-group', { detail: { groupId: inactiveId } })))

    expect(result.current.activeGroupId).toBe(activeId)
    expect(result.current.panes[0]).toBe('active-tab')
    expect(result.current.viewGroups.some(group => group.id === inactiveId)).toBe(false)
  })
})
