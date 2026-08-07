/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkspaceRootRow from '../WorkspaceRootRow'
import type { Workspace } from '@omniterm/contract'

const ws: Workspace = { id: 'w1', name: 'My Project', path: 'F:\\proj' }

describe('WorkspaceRootRow', () => {
  it('renders the workspace name', () => {
    render(<WorkspaceRootRow workspace={ws} expanded={false} connectionAction={null} onToggle={vi.fn()} onOpenTerminal={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByText('My Project')).toBeInTheDocument()
  })

  it('uses workspace.path as title', () => {
    render(<WorkspaceRootRow workspace={ws} expanded={false} connectionAction={null} onToggle={vi.fn()} onOpenTerminal={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByTitle('F:\\proj')).toBeInTheDocument()
  })

  it('shows ChevronDown when expanded, ChevronRight when collapsed', () => {
    const { rerender } = render(<WorkspaceRootRow workspace={ws} expanded connectionAction={null} onToggle={vi.fn()} onOpenTerminal={vi.fn()} onRemove={vi.fn()} />)
    expect(document.querySelector('.lucide-chevron-down')).toBeInTheDocument()
    rerender(<WorkspaceRootRow workspace={ws} expanded={false} connectionAction={null} onToggle={vi.fn()} onOpenTerminal={vi.fn()} onRemove={vi.fn()} />)
    expect(document.querySelector('.lucide-chevron-right')).toBeInTheDocument()
  })

  it('clicking the row calls onToggle', () => {
    const onToggle = vi.fn()
    const { container } = render(<WorkspaceRootRow workspace={ws} expanded={false} connectionAction={null} onToggle={onToggle} onOpenTerminal={vi.fn()} onRemove={vi.fn()} />)
    fireEvent.click(container.firstChild as HTMLElement)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('Open Terminal button click calls onOpenTerminal and stops propagation', () => {
    const onToggle = vi.fn()
    const onOpenTerminal = vi.fn()
    render(<WorkspaceRootRow workspace={ws} expanded={false} connectionAction={null} onToggle={onToggle} onOpenTerminal={onOpenTerminal} onRemove={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Open terminal here'))
    expect(onOpenTerminal).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('Remove button click calls onRemove and stops propagation', () => {
    const onToggle = vi.fn()
    const onRemove = vi.fn()
    render(<WorkspaceRootRow workspace={ws} expanded={false} connectionAction={null} onToggle={onToggle} onOpenTerminal={vi.fn()} onRemove={onRemove} />)
    fireEvent.click(screen.getByTitle('Remove from workspaces'))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('renders connectionAction ReactNode when provided', () => {
    render(<WorkspaceRootRow workspace={ws} expanded={false} connectionAction={<button>Add Connection</button>} onToggle={vi.fn()} onOpenTerminal={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByText('Add Connection')).toBeInTheDocument()
  })
})
