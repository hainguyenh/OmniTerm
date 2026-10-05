/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Workspace } from '@omniterm/contract'
import WorkspaceRootRow from '../WorkspaceRootRow'
import { cssRule } from './workspaceTreeCss'

const ws: Workspace = {
  id: 'w1',
  name: 'My Project',
  folders: [{ id: 'f1', name: 'Project', path: 'F:\\proj' }],
  order: 0,
  pins: [],
}

const openActions = () => fireEvent.click(screen.getByRole('button', { name: 'Actions for My Project' }))

const props = () => ({
  workspace: ws,
  expanded: false,
  onToggle: vi.fn(),
  onAddFolder: vi.fn(),
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
  onRemove: vi.fn(),
  onRename: vi.fn(),
})

describe('WorkspaceRootRow', () => {
  it('replaces the standard workspace icon with the custom icon at normal size', () => {
    const { container } = render(<WorkspaceRootRow {...props()} workspace={{ ...ws, icon: 'star', color: 'purple' }} />)
    const customIcon = screen.getByLabelText('Workspace custom icon')
    expect(customIcon).toHaveClass('workspace-root-icon')
    expect(cssRule('.workspace-root-icon')).toContain('width: 16px;')
    expect(screen.queryByLabelText('Workspace icon')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Workspace drag handle')).not.toBeInTheDocument()
    expect(Array.from(container.querySelectorAll('[data-workspace-id="w1"] .workspace-root-icon'))).toEqual([customIcon])
  })

  it('renders the container name and single folder path tooltip', () => {
    render(<WorkspaceRootRow {...props()} />)
    expect(screen.getByText('My Project')).toBeInTheDocument()
    expect(screen.getByTitle('F:\\proj')).toBeInTheDocument()
  })

  it('opens workspace rename from the action button without toggling the row', () => {
    const current = props()
    render(<WorkspaceRootRow {...current} />)
    openActions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename workspace' }))
    expect(screen.getByDisplayValue('My Project')).toBeInTheDocument()
    expect(current.onToggle).not.toHaveBeenCalled()
  })

  it('invokes add and remove actions without toggling the row', () => {
    const current = props()
    render(<WorkspaceRootRow {...current} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add folder to workspace' }))
    openActions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from workspaces' }))
    expect(current.onAddFolder).toHaveBeenCalledOnce()
    expect(current.onRemove).toHaveBeenCalledOnce()
    expect(current.onToggle).not.toHaveBeenCalled()
  })

  it('clicking the row toggles expansion', () => {
    const current = props()
    const { container } = render(<WorkspaceRootRow {...current} />)
    fireEvent.click(container.firstChild as HTMLElement)
    expect(current.onToggle).toHaveBeenCalledOnce()
  })

  it('opens an inline text input on double click and submits on Enter', () => {
    const onRename = vi.fn()
    render(<WorkspaceRootRow {...props()} onRename={onRename} />)
    const label = screen.getByText('My Project')
    fireEvent.doubleClick(label)
    const input = screen.getByDisplayValue('My Project')
    fireEvent.change(input, { target: { value: 'Renamed Workspace' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('w1', 'Renamed Workspace')
  })

  it('renders the folder count badge at the rightmost position', () => {
    const multiFolderWs: Workspace = {
      ...ws,
      folders: [
        { id: 'f1', name: 'Proj 1', path: 'F:\\proj1' },
        { id: 'f2', name: 'Proj 2', path: 'F:\\proj2' },
      ],
    }
    render(<WorkspaceRootRow {...props()} workspace={multiFolderWs} />)
    const badge = screen.getByTitle('2 folder(s)')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('2')
  })

  it('paints the workspace row with the sidebar theme background', () => {
    const { container } = render(<WorkspaceRootRow {...props()} />)
    const row = container.querySelector('[data-workspace-id="w1"]') as HTMLElement
    expect(row).toHaveClass('workspace-root-row')
    expect(cssRule('.workspace-root-row')).toContain('background: var(--theme-sidebar-bg);')
    expect(cssRule('.workspace-root-row:hover')).toContain('background: var(--theme-hover-bg);')
  })

  it('keeps only add-folder inline and fades it in so hovering never moves the title', () => {
    render(<WorkspaceRootRow {...props()} />)
    expect(screen.getByRole('button', { name: 'Add folder to workspace' })).toHaveClass('workspace-quick-action')
    expect(cssRule('.workspace-quick-action')).toContain('opacity: 0;')
    expect(screen.queryByRole('button', { name: 'Rename workspace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove from workspaces' })).not.toBeInTheDocument()
  })

  it('opens the actions menu on right-click and keeps removal last', () => {
    const current = props()
    const { container } = render(<WorkspaceRootRow {...current} canMoveUp canMoveDown onAppearance={vi.fn()} />)
    fireEvent.contextMenu(container.firstChild as HTMLElement, { clientX: 12, clientY: 30 })
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Add folder to workspace', 'Rename workspace', 'Workspace appearance…',
      'Move workspace up', 'Move workspace down', 'Remove from workspaces',
    ])
    expect(current.onToggle).not.toHaveBeenCalled()
  })

  it('moves the workspace from the menu and with Alt+Arrow keys', () => {
    const current = props()
    const { container, rerender } = render(<WorkspaceRootRow {...current} canMoveDown />)
    const toggle = () => container.querySelector('.workspace-root-toggle') as HTMLElement
    openActions()
    expect(screen.queryByRole('menuitem', { name: 'Move workspace up' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move workspace down' }))
    expect(current.onMoveDown).toHaveBeenCalledOnce()

    fireEvent.keyDown(toggle(), { key: 'ArrowUp', altKey: true })
    expect(current.onMoveUp).not.toHaveBeenCalled()
    fireEvent.keyDown(toggle(), { key: 'ArrowDown' })
    expect(current.onMoveDown).toHaveBeenCalledOnce()
    fireEvent.keyDown(toggle(), { key: 'ArrowDown', altKey: true })
    expect(current.onMoveDown).toHaveBeenCalledTimes(2)

    rerender(<WorkspaceRootRow {...current} canMoveUp />)
    fireEvent.keyDown(toggle(), { key: 'ArrowUp', altKey: true })
    expect(current.onMoveUp).toHaveBeenCalledOnce()
    expect(current.onToggle).not.toHaveBeenCalled()
  })
})
