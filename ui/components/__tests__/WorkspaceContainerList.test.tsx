/**
 * @vitest-environment jsdom
 */
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@omniterm/contract'
import WorkspaceContainerList from '../WorkspaceContainerList'

const workspace = (id: string, name: string, order: number, parentId?: string): Workspace => ({
  id,
  name,
  folders: [{ id: `folder#${id}`, name, path: `C:/${name}` }],
  ...(parentId ? { parentId } : {}),
  order,
  pins: [],
})

const renderList = (workspaces: Workspace[], onMove = vi.fn()) => {
  render(
    <WorkspaceContainerList
      workspaces={workspaces}
      expandedId={null}
      onToggle={vi.fn()}
      onAddFolder={vi.fn()}
      onRemove={vi.fn()}
      onMove={onMove}
      renderExpanded={() => null}
    />,
  )
  return onMove
}

describe('WorkspaceContainerList', () => {
  it('renders nested workspace references underneath their parent', () => {
    renderList([
      workspace('parent', 'Parent', 0),
      workspace('sibling', 'Sibling', 1),
      workspace('child', 'Child', 0, 'parent'),
    ])

    const rows = screen.getAllByText(/Parent|Child|Sibling/).map(node => node.textContent)
    expect(rows).toEqual(['Parent', 'Child', 'Sibling'])
    const childRow = screen.getByText('Child').closest('[data-workspace-id="child"]')
    expect((childRow as HTMLElement).style.marginInlineStart).toBe('18px')
  })

  it('moves siblings with Alt+Arrow keys and the menu, never past either end', () => {
    const onMove = renderList([
      workspace('a', 'Alpha', 0),
      workspace('b', 'Beta', 1),
      workspace('child', 'Child', 0, 'a'),
    ])
    const toggle = (id: string) => document.querySelector(`[data-workspace-id="${id}"] .workspace-root-toggle`) as HTMLElement

    fireEvent.keyDown(toggle('a'), { key: 'ArrowUp', altKey: true })
    fireEvent.keyDown(toggle('child'), { key: 'ArrowDown', altKey: true })
    expect(onMove).not.toHaveBeenCalled()

    fireEvent.keyDown(toggle('a'), { key: 'ArrowDown', altKey: true })
    expect(onMove).toHaveBeenLastCalledWith('a', null, 1)

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Beta' }))
    expect(screen.queryByRole('menuitem', { name: 'Move workspace down' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move workspace up' }))
    expect(onMove).toHaveBeenLastCalledWith('b', null, 0)
  })

  it('returns focus to a moved workspace when the reorder drops it', () => {
    const onMove = vi.fn()
    const list = (workspaces: Workspace[]) => (
      <WorkspaceContainerList
        workspaces={workspaces}
        expandedId={null}
        onToggle={vi.fn()}
        onAddFolder={vi.fn()}
        onRemove={vi.fn()}
        onMove={onMove}
        renderExpanded={() => null}
      />
    )
    const { rerender } = render(list([workspace('a', 'Alpha', 0), workspace('b', 'Beta', 1)]))
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move workspace down' }))
    expect(document.activeElement).toBe(document.body)

    rerender(list([workspace('b', 'Beta', 0), workspace('a', 'Alpha', 1)]))
    expect(document.activeElement).toBe(document.querySelector('[data-workspace-id="a"] .workspace-root-toggle'))
  })

  it('reorders siblings via drag and drop', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}),
    }))
    const onMove = renderList([
      workspace('a', 'Alpha', 0),
      workspace('b', 'Beta', 1),
    ])

    const beta = screen.getByText('Beta').closest('[data-workspace-id="b"]') as HTMLElement
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn(() => 'a') }

    const dropEvent = createEvent.drop(beta, { dataTransfer })
    Object.defineProperty(dropEvent, 'clientY', { value: 5 })
    fireEvent(beta, dropEvent)

    expect(onMove).toHaveBeenCalledWith('a', null, 0)
  })

  it('drops a workspace onto the center of another workspace to nest it', () => {
    const onMove = renderList([
      workspace('a', 'Alpha', 0),
      workspace('b', 'Beta', 1),
    ])
    const alpha = screen.getByText('Alpha').closest('[data-workspace-id="a"]') as HTMLElement
    const beta = screen.getByText('Beta').closest('[data-workspace-id="b"]') as HTMLElement
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}),
    })
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn(() => 'a') }

    fireEvent.dragStart(alpha, { dataTransfer })
    fireEvent.drop(beta, { dataTransfer, clientY: 20 })

    expect(onMove).toHaveBeenCalledWith('a', 'b', 0)
  })
})
