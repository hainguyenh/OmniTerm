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
})

describe('WorkspaceRootRow', () => {
  it('renders the container name and single folder path tooltip', () => {
    render(<WorkspaceRootRow {...props()} />)
    expect(screen.getByText('My Project')).toBeInTheDocument()
    expect(screen.getByTitle('F:\\proj')).toBeInTheDocument()
  })

  it('does not offer a terminal action on a synthetic workspace root', () => {
    render(<WorkspaceRootRow {...props()} />)
    expect(screen.queryByTitle('Open terminal here')).not.toBeInTheDocument()
  })

  it('invokes add and remove actions without toggling the row', () => {
    const current = props()
    render(<WorkspaceRootRow {...current} />)
    fireEvent.click(screen.getByTitle('Add folder to workspace'))
    fireEvent.click(screen.getByTitle('Remove from workspaces'))
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
})
