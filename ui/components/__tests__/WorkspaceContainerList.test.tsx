/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(childRow).toHaveStyle({ paddingLeft: '20px' })
  })

  it('reorders siblings via drag and drop', () => {
    const onMove = renderList([
      workspace('a', 'Alpha', 0),
      workspace('b', 'Beta', 1),
    ])

    const alpha = screen.getByText('Alpha').closest('[data-workspace-id="a"]') as HTMLElement
    const beta = screen.getByText('Beta').closest('[data-workspace-id="b"]') as HTMLElement
    Object.defineProperty(beta, 'getBoundingClientRect', {
      value: () => ({ top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) }),
    })
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn(() => 'a') }

    fireEvent.dragStart(alpha, { dataTransfer })
    fireEvent.drop(beta, { dataTransfer, clientY: 5 })

    expect(onMove).toHaveBeenCalledWith('a', null, 0)
  })

  it('drops a workspace onto the center of another workspace to nest it', () => {
    const onMove = renderList([
      workspace('a', 'Alpha', 0),
      workspace('b', 'Beta', 1),
    ])
    const alpha = screen.getByText('Alpha').closest('[data-workspace-id="a"]') as HTMLElement
    const beta = screen.getByText('Beta').closest('[data-workspace-id="b"]') as HTMLElement
    Object.defineProperty(beta, 'getBoundingClientRect', {
      value: () => ({ top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) }),
    })
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn(() => 'a') }

    fireEvent.dragStart(alpha, { dataTransfer })
    fireEvent.drop(beta, { dataTransfer, clientY: 20 })

    expect(onMove).toHaveBeenCalledWith('a', 'b', 0)
  })
})
