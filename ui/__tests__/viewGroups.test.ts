import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW_GROUP_ID, visibleTabsForGroup } from '../viewGroups'

describe('visibleTabsForGroup', () => {
  const tabs = [{ id: 'ungrouped' }, { id: 'grouped' }]

  it('keeps only ungrouped tabs visible in the default group', () => {
    expect(visibleTabsForGroup(tabs, { grouped: 'group-a' }, DEFAULT_VIEW_GROUP_ID)).toEqual([{ id: 'ungrouped' }])
  })

  it('filters grouped tabs when a group is selected', () => {
    expect(visibleTabsForGroup(tabs, { grouped: 'group-a' }, 'group-a')).toEqual([{ id: 'grouped' }])
    expect(visibleTabsForGroup(tabs, { grouped: 'group-b' }, 'group-a')).toEqual([])
  })
})
