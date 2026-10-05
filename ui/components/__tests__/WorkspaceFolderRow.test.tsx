/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceTreeNode } from '../../utils/scriptTree'
import { WorkspaceFolderRow } from '../WorkspaceFolderRow'

const rootNode: WorkspaceTreeNode = { name: 'folder#1', path: 'folder#1', isDir: true, children: [] }
const subNode: WorkspaceTreeNode = { name: 'src', path: 'folder#1/src', isDir: true, children: [] }
const rootFolder = { id: 'folder#1', name: 'api', path: 'D:/work/api' }

const renderRow = (props: Partial<Parameters<typeof WorkspaceFolderRow>[0]> = {}) => {
  const current = {
    onToggle: vi.fn(),
    onOpenTerminal: vi.fn(),
    onTogglePinned: vi.fn(),
    onNewFile: vi.fn(),
    onNewFolder: vi.fn(),
    onRenameAlias: vi.fn(),
    onOpenFilterMenu: vi.fn(),
    onUnlink: vi.fn(),
    ...props,
  }
  const view = render(
    <WorkspaceFolderRow
      node={subNode}
      expanded={false}
      loading={false}
      filterActive={false}
      pinned={false}
      connectionAction={null}
      {...current}
    />,
  )
  return { ...view, current }
}

const menuItems = () => screen.getAllByRole('menuitem').map(item => item.textContent)

describe('WorkspaceFolderRow', () => {
  it('offers new file and new folder on a subfolder, without root-only actions', () => {
    const { current } = renderRow()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for src' }))
    expect(menuItems()).toEqual(['Open terminal here', 'New file…', 'New folder…', 'Pin item'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'New folder…' }))
    expect(current.onNewFolder).toHaveBeenCalledOnce()
    expect(current.onToggle).not.toHaveBeenCalled()
  })

  it('opens the same grouped menu on right-click for root folders, not the filter popover', () => {
    const { container, current } = renderRow({ node: rootNode, rootFolder })
    fireEvent.contextMenu(container.firstChild as HTMLElement, { clientX: 30, clientY: 40 })
    expect(screen.getByRole('menu', { name: 'Actions for api' })).toBeInTheDocument()
    expect(current.onOpenFilterMenu).not.toHaveBeenCalled()
    expect(menuItems()).toEqual([
      'Open terminal here', 'New file…', 'New folder…', 'Pin item', 'Rename folder',
      'Folder filter & appearance…', 'Unlink folder from workspace',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Folder filter & appearance…' }))
    expect(current.onOpenFilterMenu).toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number) }))
  })

  it('renames a root folder alias inline from its menu', () => {
    const { current } = renderRow({ node: rootNode, rootFolder })
    fireEvent.click(screen.getByRole('button', { name: 'Actions for api' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename folder' }))
    const input = screen.getByRole('textbox', { name: 'Folder alias' })
    fireEvent.change(input, { target: { value: 'backend' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(current.onRenameAlias).toHaveBeenCalledWith('backend')
  })

  it('shows the root folder absolute path in its tooltip, not its internal id', async () => {
    renderRow({ node: rootNode, rootFolder })
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'api' }))
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('D:/work/api')
    expect(tooltip.querySelector('strong')).toHaveTextContent('api')
    expect(tooltip).not.toHaveTextContent('folder#1')
  })
})
