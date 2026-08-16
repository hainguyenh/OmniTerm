/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ViewGroupTabs from '../ViewGroupTabs'
import { createDefaultViewGroup, createViewGroup } from '../../viewGroups'

describe('ViewGroupTabs', () => {
  it('opens group options from the context menu, renames, and changes color', () => {
    const onUpdate = vi.fn()
    const onUngroup = vi.fn()
    const group = { ...createViewGroup('view-1', 1), panes: ['terminal', null, null, null, null, null, null, null] }
    render(<ViewGroupTabs groups={[group]} activeGroupId="view-1" onSelect={vi.fn()} onUpdate={onUpdate} onReorder={vi.fn()} onUngroup={onUngroup} />)

    fireEvent.contextMenu(screen.getByRole('tab'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename group' }))
    expect(screen.getByRole('menu', { name: 'Desktop 1 options' })).toBeInTheDocument()
    expect(screen.getByRole('tab')).not.toContainElement(screen.getByLabelText('Group name'))
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Work' } })
    fireEvent.keyDown(screen.getByLabelText('Group name'), { key: 'Enter' })
    expect(onUpdate).toHaveBeenCalledWith('view-1', { label: 'Work' })

    fireEvent.contextMenu(screen.getByRole('tab'))
    fireEvent.click(screen.getByRole('button', { name: 'Set color #34d399' }))
    expect(onUpdate).toHaveBeenCalledWith('view-1', { color: '#34d399' })
  })

  it('uses the selected color as the tab background and supports dragging order', () => {
    const onReorder = vi.fn()
    const groups = [{ ...createViewGroup('view-1', 1), color: '#60a5fa' }, createViewGroup('view-2', 2)]
    render(<ViewGroupTabs groups={groups} activeGroupId="view-1" onSelect={vi.fn()} onUpdate={vi.fn()} onReorder={onReorder} onUngroup={vi.fn()} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveStyle({ backgroundColor: '#60a5fa26' })
    vi.spyOn(tabs[1], 'getBoundingClientRect').mockReturnValue({ left: 100, width: 100 } as DOMRect)
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'view-1') }
    fireEvent.dragStart(tabs[0], { dataTransfer })
    fireEvent.drop(tabs[1], { dataTransfer, clientX: 120 })
    expect(onReorder).toHaveBeenCalledWith('view-1', 'view-2', false)
  })

  it('cancels an in-menu rename without updating the group', () => {
    const onUpdate = vi.fn()
    const group = createViewGroup('view-1', 1)
    render(<ViewGroupTabs groups={[group]} activeGroupId="view-1" onSelect={vi.fn()} onUpdate={onUpdate} onReorder={vi.fn()} onUngroup={vi.fn()} />)

    fireEvent.contextMenu(screen.getByRole('tab'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename group' }))
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Discarded' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Group name')).not.toBeInTheDocument()
  })

  it('keeps the default ungrouped group from being removed', () => {
    render(<ViewGroupTabs groups={[createDefaultViewGroup()]} activeGroupId="ungrouped" onSelect={vi.fn()} onUpdate={vi.fn()} onReorder={vi.fn()} onUngroup={vi.fn()} />)

    fireEvent.contextMenu(screen.getByRole('tab'))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('tab')).toHaveStyle({ backgroundColor: '#6b728026' })
  })

  it('shows the total tab count on Ungrouped and keeps it at the right edge', () => {
    const groups = [createDefaultViewGroup(), createViewGroup('view-1', 1)]
    render(<ViewGroupTabs groups={groups} activeGroupId="ungrouped" totalTabCount={7} onSelect={vi.fn()} onUpdate={vi.fn()} onReorder={vi.fn()} onUngroup={vi.fn()} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.at(-1)).toHaveTextContent('Ungrouped')
    expect(tabs.at(-1)).toHaveTextContent('7')
  })

  it('ungroups an explicit group from its context menu', () => {
    const onUngroup = vi.fn()
    render(<ViewGroupTabs groups={[createViewGroup('view-1', 1)]} activeGroupId="view-1" onSelect={vi.fn()} onUpdate={vi.fn()} onReorder={vi.fn()} onUngroup={onUngroup} />)

    fireEvent.contextMenu(screen.getByRole('tab'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ungroup' }))

    expect(onUngroup).toHaveBeenCalledWith('view-1')
  })
})
