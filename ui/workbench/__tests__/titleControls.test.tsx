/**
 * @vitest-environment jsdom
 */
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registered = vi.hoisted(() => ({
  items: [] as Array<{ id: string; align: string; priority: number; component: () => unknown }>,
  popup: null as unknown,
}))

vi.mock('../../ide/workbench/contributions', () => ({
  registerTitleItem: vi.fn((item: (typeof registered.items)[number]) => {
    registered.items.push(item)
    return () => {}
  }),
  provideProjectPopup: vi.fn((component: unknown) => {
    registered.popup = component
    return () => {}
  }),
}))
import { registerTitleControls } from '../titleControls'
import { useTitleControlsProps } from '../titleControlsStore'
import { ProjectFilterItem } from '../titlebar/ProjectFilterItem'
import { WorkspacePopup } from '../titlebar/WorkspacePopup'

describe('title controls', () => {
  beforeEach(() => {
    act(() => useTitleControlsProps.setState({ props: null }))
    registered.items = []
    registered.popup = null
  })

  it('provides the workspace popup and the OmniTerm title items', () => {
    registerTitleControls()
    expect(registered.popup).toBe(WorkspacePopup)
    expect(registered.items.map((i) => i.id)).toEqual(['omniterm.projectFilter', 'omniterm.themePicker', 'omniterm.themeMode', 'omniterm.update'])
    const filter = registered.items[0]
    expect(filter).toMatchObject({ align: 'left', component: ProjectFilterItem })
    // Before the branch widget (priority 10), so the order is project, filter, branch.
    expect(filter.priority).toBeLessThan(10)
    // The light/dark switch and the update indicator follow Search Everywhere, before the gear.
    for (const item of registered.items.slice(1)) expect(item).toMatchObject({ align: 'right', trailing: true })
  })

  it('leaves the font size and zoom controls out of the title bar', () => {
    registerTitleControls()
    expect(registered.items.map((i) => i.id)).not.toContain('omniterm.appearance')
  })

  it('unregisters everything', () => {
    const dispose = registerTitleControls()
    expect(() => dispose()).not.toThrow()
  })
})
