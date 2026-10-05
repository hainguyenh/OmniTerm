/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry } from '@omniterm/contract'

import type { WorkspaceTreeNode } from '../../utils/scriptTree'
import { WorkspaceFileRow } from '../WorkspaceFileRow'

const entry: WorkspaceEntry = {
  id: 'root/deploy.ps1', name: 'deploy.ps1', path: 'root/deploy.ps1', isDir: false, kind: 'ps1', editable: true,
}
const script = { id: entry.id, name: entry.name, path: entry.path, kind: 'ps1', editable: true }
const node: WorkspaceTreeNode = {
  name: 'deploy.ps1', path: 'root/deploy.ps1', isDir: false, entry, script, openable: script, children: [],
}

const handlers = () => ({
  onOpen: vi.fn(),
  onRun: vi.fn(),
  onTogglePinned: vi.fn(),
  onRename: vi.fn(),
  onMove: vi.fn(),
  onDelete: vi.fn(),
})

const renderRow = (props: Partial<Parameters<typeof WorkspaceFileRow>[0]> = {}) => {
  const current = { ...handlers(), ...props }
  const view = render(
    <WorkspaceFileRow
      node={node}
      label="deploy.ps1"
      depth={2}
      pinned={false}
      highlighted={false}
      active={false}
      rowRef={() => {}}
      {...current}
    />,
  )
  return { ...view, current }
}

const openActions = () => fireEvent.click(screen.getByRole('button', { name: 'Actions for deploy.ps1' }))

describe('WorkspaceFileRow', () => {
  it('groups run, pin, rename and move in the menu with deletion last', () => {
    const { current } = renderRow()
    openActions()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Run', 'Pin item', 'Rename file', 'Move file to…', 'Delete file',
    ])
    expect(screen.getByRole('menuitem', { name: 'Delete file' })).toHaveAttribute('data-danger', 'true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move file to…' }))
    expect(current.onMove).toHaveBeenCalledOnce()
    openActions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete file' }))
    expect(current.onDelete).toHaveBeenCalledOnce()
    expect(current.onOpen).not.toHaveBeenCalled()
  })

  it('omits edit actions the host does not supply', () => {
    renderRow({ onRename: undefined, onMove: undefined, onDelete: undefined })
    openActions()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Run', 'Pin item'])
  })

  it('renames inline from the menu, selecting the stem and submitting on Enter', () => {
    const { current } = renderRow()
    openActions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename file' }))
    const input = screen.getByRole('textbox', { name: 'File name' }) as HTMLInputElement
    expect(input).toHaveFocus()
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'deploy'.length])

    fireEvent.change(input, { target: { value: ' release.ps1 ' } })
    fireEvent.click(input)
    expect(current.onOpen).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(current.onRename).toHaveBeenCalledWith('release.ps1')
    expect(screen.queryByRole('textbox', { name: 'File name' })).not.toBeInTheDocument()
  })

  it('starts renaming with F2 and drops an unchanged, blank or cancelled name', () => {
    const { current } = renderRow()
    const label = screen.getByRole('button', { name: 'deploy.ps1' })
    fireEvent.keyDown(label, { key: 'F2' })
    fireEvent.blur(screen.getByRole('textbox', { name: 'File name' }))

    fireEvent.keyDown(screen.getByRole('button', { name: 'deploy.ps1' }), { key: 'F2' })
    fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), { target: { value: '   ' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'File name' }), { key: 'Enter' })

    fireEvent.keyDown(screen.getByRole('button', { name: 'deploy.ps1' }), { key: 'F2' })
    fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), { target: { value: 'other.ps1' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'File name' }), { key: 'Escape' })

    expect(current.onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'deploy.ps1' })).toBeInTheDocument()
  })

  it('marks the file open in the active editor tab until it is no longer active', () => {
    const { container, rerender, current } = renderRow({ active: true })
    const row = container.firstChild as HTMLElement
    expect(row).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: 'deploy.ps1' })).toHaveAttribute('aria-current', 'true')

    rerender(
      <WorkspaceFileRow node={node} label="deploy.ps1" depth={2} pinned={false} highlighted={false}
        rowRef={() => {}} {...current} active={false} />,
    )
    expect(row).not.toHaveAttribute('data-active')
    expect(screen.getByRole('button', { name: 'deploy.ps1' })).not.toHaveAttribute('aria-current')
  })

  it('opens the file actions on right-click without opening the file', () => {
    const { container, current } = renderRow()
    fireEvent.contextMenu(container.firstChild as HTMLElement, { clientX: 90, clientY: 20 })
    expect(screen.getByRole('menu', { name: 'Actions for deploy.ps1' }).style.left).toBe('90px')
    expect(current.onOpen).not.toHaveBeenCalled()
  })
})
