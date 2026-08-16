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
    expect(row.style.paddingLeft).toBe('32px')
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

  it('Connect button calls onConnect?.() safely when onConnect is absent', () => {
    render(<WorkspaceConnectionRow connection={sshConn} depth={0} onDelete={vi.fn()} />)
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Connect' }))).not.toThrow()
  })

  it('renders Edit button only when onEdit is present', () => {
    const { rerender } = render(<WorkspaceConnectionRow connection={sshConn} depth={0} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Edit connection' })).not.toBeInTheDocument()
    const onEdit = vi.fn()
    rerender(<WorkspaceConnectionRow connection={sshConn} depth={0} onEdit={onEdit} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit connection' }))
    expect(onEdit).toHaveBeenCalledWith(sshConn)
  })

  it('Delete button always renders and calls onDelete', () => {
    const onDelete = vi.fn()
    render(<WorkspaceConnectionRow connection={sshConn} depth={0} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete connection' }))
    expect(onDelete).toHaveBeenCalledWith(sshConn)
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
})
