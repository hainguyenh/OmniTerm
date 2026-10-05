/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkspaceConnectionRow from '../WorkspaceConnectionRow'
import type { Connection } from '@omniterm/contract'

const sshConn: Connection = {
  id: 'c1', name: 'Prod Box', type: 'SSH', host: 'prod.example.com', port: '22', user: 'admin',
}
const rdpConn: Connection = {
  id: 'c2', name: 'DC Box', type: 'RDP', host: 'dc.example.com', port: '3389', user: 'admin',
}
const localConn: Connection = {
  id: 'c3', name: 'Local Dev', type: 'LOCAL', host: '', port: '', user: '',
}

const openActions = () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Prod Box' }))

describe('WorkspaceConnectionRow', () => {
  beforeEach(() => {})

  it('renders the connection name and type badge for SSH', () => {
    render(<WorkspaceConnectionRow connection={sshConn} depth={0} onDelete={vi.fn()} />)
    expect(screen.getByText('Prod Box')).toBeInTheDocument()
    expect(screen.getByText('SSH')).toBeInTheDocument()
  })

  it('uses user@host:port title for non-LOCAL types', () => {
    render(<WorkspaceConnectionRow connection={sshConn} depth={0} onDelete={vi.fn()} />)
    expect(screen.getByTitle('admin@prod.example.com:22')).toBeInTheDocument()
  })

  it('uses connection.name title for LOCAL', () => {
    render(<WorkspaceConnectionRow connection={localConn} depth={0} onDelete={vi.fn()} />)
    expect(screen.getByTitle('Local Dev')).toBeInTheDocument()
  })

  it('handles missing user in non-LOCAL title', () => {
    const noUser: Connection = { ...sshConn, user: '' }
    render(<WorkspaceConnectionRow connection={noUser} depth={0} onDelete={vi.fn()} />)
    expect(screen.getByTitle('prod.example.com:22')).toBeInTheDocument()
  })

  it('indents by depth', () => {
    const { container } = render(<WorkspaceConnectionRow connection={sshConn} depth={2} onDelete={vi.fn()} />)
    const row = container.firstChild as HTMLElement
    expect(row.style.getPropertyValue('--tree-depth')).toBe('2')
  })

  it('double-click calls onConnect', () => {
    const onConnect = vi.fn()
    const { container } = render(<WorkspaceConnectionRow connection={sshConn} depth={0} onConnect={onConnect} onDelete={vi.fn()} />)
    fireEvent.doubleClick(container.firstChild as HTMLElement)
    expect(onConnect).toHaveBeenCalledWith(sshConn)
  })

  it('Connect button click calls onConnect and stops propagation', () => {
    const onConnect = vi.fn()
    render(<WorkspaceConnectionRow connection={sshConn} depth={0} onConnect={onConnect} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onConnect).toHaveBeenCalledWith(sshConn)
  })

  it('offers no connect action when onConnect is absent', () => {
    render(<WorkspaceConnectionRow connection={sshConn} depth={0} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prod Box' })).toBeDisabled()
    openActions()
    expect(screen.queryByRole('menuitem', { name: 'Connect' })).not.toBeInTheDocument()
  })

  it('lists Edit in the actions menu only when onEdit is present', () => {
    const { rerender } = render(<WorkspaceConnectionRow connection={sshConn} depth={0} onDelete={vi.fn()} />)
    openActions()
    expect(screen.queryByRole('menuitem', { name: 'Edit connection' })).not.toBeInTheDocument()
    const onEdit = vi.fn()
    rerender(<WorkspaceConnectionRow connection={sshConn} depth={0} onEdit={onEdit} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit connection' }))
    expect(onEdit).toHaveBeenCalledWith(sshConn)
  })

  it('always lists Delete last in the actions menu and calls onDelete', () => {
    const onDelete = vi.fn()
    render(<WorkspaceConnectionRow connection={sshConn} depth={0} onConnect={vi.fn()} onEdit={vi.fn()} onDelete={onDelete} />)
    openActions()
    const items = screen.getAllByRole('menuitem').map(item => item.textContent)
    expect(items).toEqual(['Connect', 'Edit connection', 'Delete connection'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete connection' }))
    expect(onDelete).toHaveBeenCalledWith(sshConn)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the same actions menu at the pointer on right-click', () => {
    const { container } = render(<WorkspaceConnectionRow connection={sshConn} depth={0} onEdit={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.contextMenu(container.firstChild as HTMLElement, { clientX: 40, clientY: 50 })
    const menu = screen.getByRole('menu', { name: 'Actions for Prod Box' })
    expect(menu.style.left).toBe('40px')
    expect(menu.style.top).toBe('54px')
    expect(screen.getByRole('menuitem', { name: 'Edit connection' })).toHaveFocus()
  })

  it('renders a Monitor icon for RDP connection type', () => {
    render(<WorkspaceConnectionRow connection={rdpConn} depth={0} onDelete={vi.fn()} />)
    expect(screen.getByText('DC Box')).toBeInTheDocument()
    expect(screen.getByText('RDP')).toBeInTheDocument()
  })

  it('renders a Terminal icon for LOCAL connection type', () => {
    render(<WorkspaceConnectionRow connection={localConn} depth={0} onDelete={vi.fn()} />)
    expect(screen.getByText('LOCAL')).toBeInTheDocument()
  })

  it('keeps only quick connect inline so the connection title gets the row width', () => {
    render(<WorkspaceConnectionRow connection={sshConn} depth={0} onConnect={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveClass('workspace-run-action')
    expect(screen.queryByRole('button', { name: 'Edit connection' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete connection' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions for Prod Box' })).toHaveAttribute('aria-haspopup', 'menu')
  })
})
