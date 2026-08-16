/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkspaceTreeToolbar from '../WorkspaceTreeToolbar'
import { DEFAULT_TREE_FILTER, type TreeFilter } from '../../utils/workspaceFilter'

describe('WorkspaceTreeToolbar', () => {
  it('renders the filter summary label for default scripts mode', () => {
    render(<WorkspaceTreeToolbar
      filter={DEFAULT_TREE_FILTER}
      fileCount={0}
      onOpenFilterMenu={vi.fn()}
      filterMenuOpen={false}
      allCollapsed={null}
      onToggleCollapseAll={vi.fn()}
      flatView={false}
      onToggleFlatView={vi.fn()}
      scanning={false}
      onRescan={vi.fn()}
    />)
    expect(screen.getByText('Scripts')).toBeInTheDocument()
  })

  it(' renders filter label "All files" for all mode', () => {
    const filter: TreeFilter = { ...DEFAULT_TREE_FILTER, mode: 'all' }
    render(<WorkspaceTreeToolbar
      filter={filter} fileCount={0} onOpenFilterMenu={vi.fn()} filterMenuOpen={false}
      allCollapsed={null} onToggleCollapseAll={vi.fn()} flatView={false} onToggleFlatView={vi.fn()} scanning={false} onRescan={vi.fn()}
    />)
    expect(screen.getByText('All files')).toBeInTheDocument()
  })

  it('renders count label for selected mode', () => {
    const filter: TreeFilter = { ...DEFAULT_TREE_FILTER, mode: 'selected', paths: ['a', 'b', 'c'] }
    render(<WorkspaceTreeToolbar
      filter={filter} fileCount={3} onOpenFilterMenu={vi.fn()} filterMenuOpen={false}
      allCollapsed={null} onToggleCollapseAll={vi.fn()} flatView={false} onToggleFlatView={vi.fn()} scanning={false} onRescan={vi.fn()}
    />)
    expect(screen.getByText('3 files')).toBeInTheDocument()
  })

  it('clicking the label button calls onOpenFilterMenu with a DOMRect', () => {
    const onOpenFilterMenu = vi.fn()
    render(<WorkspaceTreeToolbar
      filter={DEFAULT_TREE_FILTER} fileCount={0} onOpenFilterMenu={onOpenFilterMenu} filterMenuOpen={false}
      allCollapsed={null} onToggleCollapseAll={vi.fn()} flatView={false} onToggleFlatView={vi.fn()} scanning={false} onRescan={vi.fn()}
    />)
    fireEvent.click(screen.getByText('Scripts'))
    expect(onOpenFilterMenu).toHaveBeenCalledTimes(1)
    const rect = onOpenFilterMenu.mock.calls[0][0]
    expect(rect).toBeTruthy()
    expect(typeof rect.x).toBe('number')
    expect(typeof rect.y).toBe('number')
    expect(typeof rect.width).toBe('number')
    expect(typeof rect.height).toBe('number')
  })

  it('Filter icon button opens the menu and has aria-expanded matching filterMenuOpen', () => {
    const onOpenFilterMenu = vi.fn()
    render(<WorkspaceTreeToolbar
      filter={DEFAULT_TREE_FILTER} fileCount={0} onOpenFilterMenu={onOpenFilterMenu} filterMenuOpen
      allCollapsed={null} onToggleCollapseAll={vi.fn()} flatView={false} onToggleFlatView={vi.fn()} scanning={false} onRescan={vi.fn()}
    />)
    const filterBtn = screen.getByLabelText('Filter what this workspace shows')
    expect(filterBtn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(filterBtn)
    expect(onOpenFilterMenu).toHaveBeenCalledTimes(1)
  })

  it('hides the Collapse/Expand all button when allCollapsed is null', () => {
    render(<WorkspaceTreeToolbar
      filter={DEFAULT_TREE_FILTER} fileCount={0} onOpenFilterMenu={vi.fn()} filterMenuOpen={false}
      allCollapsed={null} onToggleCollapseAll={vi.fn()} flatView={false} onToggleFlatView={vi.fn()} scanning={false} onRescan={vi.fn()}
    />)
    expect(screen.queryByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand all' })).not.toBeInTheDocument()
  })

  it('shows Expand all when allCollapsed=true', () => {
    render(<WorkspaceTreeToolbar
      filter={DEFAULT_TREE_FILTER} fileCount={0} onOpenFilterMenu={vi.fn()} filterMenuOpen={false}
      allCollapsed onToggleCollapseAll={vi.fn()} flatView={false} onToggleFlatView={vi.fn()} scanning={false} onRescan={vi.fn()}
    />)
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument()
  })

  it('shows Collapse all when allCollapsed=false', () => {
    const onToggleCollapseAll = vi.fn()
    render(<WorkspaceTreeToolbar
      filter={DEFAULT_TREE_FILTER} fileCount={0} onOpenFilterMenu={vi.fn()} filterMenuOpen={false}
      allCollapsed={false} onToggleCollapseAll={onToggleCollapseAll} flatView={false} onToggleFlatView={vi.fn()} scanning={false} onRescan={vi.fn()}
    />)
    const btn = screen.getByRole('button', { name: 'Collapse all' })
    fireEvent.click(btn)
    expect(onToggleCollapseAll).toHaveBeenCalledTimes(1)
  })

  it('Flatten/ListTree button toggles flat view and swaps icon', () => {
    const onToggleFlatView = vi.fn()
    const { rerender } = render(<WorkspaceTreeToolbar
      filter={DEFAULT_TREE_FILTER} fileCount={0} onOpenFilterMenu={vi.fn()} filterMenuOpen={false}
      allCollapsed={null} onToggleCollapseAll={vi.fn()} flatView={false} onToggleFlatView={onToggleFlatView} scanning={false} onRescan={vi.fn()}
    />)
    const flattenBtn = screen.getByRole('button', { name: 'Flatten' })
    expect(document.querySelector('.lucide-list')).toBeInTheDocument()
    fireEvent.click(flattenBtn)
    expect(onToggleFlatView).toHaveBeenCalledTimes(1)
    rerender(<WorkspaceTreeToolbar
      filter={DEFAULT_TREE_FILTER} fileCount={0} onOpenFilterMenu={vi.fn()} filterMenuOpen={false}
      allCollapsed={null} onToggleCollapseAll={vi.fn()} flatView onToggleFlatView={onToggleFlatView} scanning={false} onRescan={vi.fn()}
    />)
    expect(screen.getByRole('button', { name: 'Show as tree' })).toBeInTheDocument()
    expect(document.querySelector('.lucide-list-tree')).toBeInTheDocument()
  })

  it('Rescan button click calls onRescan', () => {
    const onRescan = vi.fn()
    render(<WorkspaceTreeToolbar
      filter={DEFAULT_TREE_FILTER} fileCount={0} onOpenFilterMenu={vi.fn()} filterMenuOpen={false}
      allCollapsed={null} onToggleCollapseAll={vi.fn()} flatView={false} onToggleFlatView={vi.fn()} scanning={false} onRescan={onRescan}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }))
    expect(onRescan).toHaveBeenCalledTimes(1)
  })

  it('applies spin animation to Rescan icon while scanning', () => {
    render(<WorkspaceTreeToolbar
      filter={DEFAULT_TREE_FILTER} fileCount={0} onOpenFilterMenu={vi.fn()} filterMenuOpen={false}
      allCollapsed={null} onToggleCollapseAll={vi.fn()} flatView={false} onToggleFlatView={vi.fn()} scanning onRescan={vi.fn()}
    />)
    expect(document.querySelector('.lucide-refresh-cw.animate-spin')).toBeInTheDocument()
  })

  it('tints filter triggers when filter is not default', () => {
    const filter: TreeFilter = { ...DEFAULT_TREE_FILTER, mode: 'all' }
    render(<WorkspaceTreeToolbar
      filter={filter} fileCount={0} onOpenFilterMenu={vi.fn()} filterMenuOpen={false}
      allCollapsed={null} onToggleCollapseAll={vi.fn()} flatView={false} onToggleFlatView={vi.fn()} scanning={false} onRescan={vi.fn()}
    />)
    const labelBtn = screen.getByText('All files')
    expect(labelBtn.className).toContain('text-[var(--theme-accent)]')
  })
})
