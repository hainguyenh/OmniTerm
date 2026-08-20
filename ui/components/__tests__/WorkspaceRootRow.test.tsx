/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Workspace } from '@omniterm/contract'
import WorkspaceRootRow from '../WorkspaceRootRow'

const ws: Workspace = {
  id: 'w1',
  name: 'My Project',
  folders: [{ id: 'f1', name: 'Project', path: 'F:\\proj' }],
  order: 0,
  pins: [],
}

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
    expect(customIcon).toHaveClass('h-4', 'w-4')
    expect(screen.getByLabelText('Workspace icon')).toHaveClass('h-4', 'w-4')
    expect(screen.queryByLabelText('Workspace drag handle')).not.toBeInTheDocument()
    expect(container.querySelector('[data-workspace-id="w1"]')?.querySelector('svg')).toBe(customIcon)
  })

  it('renders the container name and single folder path tooltip', () => {
    render(<WorkspaceRootRow {...props()} />)
    expect(screen.getByText('My Project')).toBeInTheDocument()
    expect(screen.getByTitle('F:\\proj')).toBeInTheDocument()
  })

  it('opens workspace rename from the action button without toggling the row', () => {
    const current = props()
    render(<WorkspaceRootRow {...current} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename workspace' }))
    expect(screen.getByDisplayValue('My Project')).toBeInTheDocument()
    expect(current.onToggle).not.toHaveBeenCalled()
  })

  it('invokes add and remove actions without toggling the row', () => {
    const current = props()
    render(<WorkspaceRootRow {...current} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add folder to workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove from workspaces' }))
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
    expect(row.className).toContain('bg-[var(--theme-sidebar-bg)]')
    expect(row.className.split(/\s+/)).not.toContain('bg-[var(--theme-bg)]')
    expect(row.className).toContain('hover:bg-[var(--theme-bg)]')
    expect(row.className).not.toContain('hover:bg-[var(--theme-hover-bg)]')
  })
})
