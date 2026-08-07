/**
 * @vitest-environment jsdom
 */
import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { CommandPalette } from '../CommandPalette'

const connections = [
  { id: 'ssh', name: 'Zulu Server', type: 'SSH', host: 'zulu', port: '22', user: 'ops' },
  { id: 'local', name: 'Local Shell', type: 'LOCAL', host: '', port: '', user: '' },
  { id: 'rdp', name: 'Alpha Desktop', type: 'RDP', host: 'desk', port: '3389', user: 'user' },
] as Connection[]

function renderPalette(overrides: Partial<ComponentProps<typeof CommandPalette>> = {}) {
  const props: ComponentProps<typeof CommandPalette> = {
    isOpen: true,
    onClose: vi.fn(),
    connections,
    onConnect: vi.fn(),
    ...overrides,
  }
  return { ...render(<CommandPalette {...props} />), props }
}

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  })

  it('renders nothing while closed', () => {
    const { container } = renderPalette({ isOpen: false })
    expect(container.firstChild).toBeNull()
  })

  it('sorts favorites, recents, then remaining connections', async () => {
    localStorage.setItem('omniterm-favorite-conns', JSON.stringify(['rdp']))
    localStorage.setItem('omniterm-recent-conns', JSON.stringify(['local']))
    renderPalette()

    await waitFor(() => expect(screen.getByText('Alpha Desktop')).toBeInTheDocument())
    const labels = screen.getAllByText(/Alpha Desktop|Local Shell|Zulu Server/).map((node) => node.textContent)
    expect(labels).toEqual(['Alpha Desktop', 'Local Shell', 'Zulu Server'])
  })

  it('filters by name or type and reports no matches', () => {
    renderPalette()
    const search = screen.getByPlaceholderText('Search connections...')
    fireEvent.change(search, { target: { value: 'ssh' } })
    expect(screen.getByText('Zulu Server')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Desktop')).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'missing' } })
    expect(screen.getByText('No connections found.')).toBeInTheDocument()
  })

  it('connects by mouse and records the recent connection', () => {
    const { props } = renderPalette()
    fireEvent.mouseEnter(screen.getByText('Local Shell').closest('[class*="cursor-pointer"]') as Element)
    fireEvent.click(screen.getByText('Local Shell'))
    expect(props.onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'local' }))
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(localStorage.getItem('omniterm-recent-conns')).toBe('["local"]')
  })

  it('navigates, stars, connects, and closes from the keyboard', () => {
    const { props } = renderPalette()
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    expect(localStorage.getItem('omniterm-favorite-conns')).toBe('["rdp"]')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(props.onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'rdp' }))
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('keeps a valid selection when connections arrive after an empty result', () => {
    const { rerender } = renderPalette({ connections: [] })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    rerender(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        connections={[connections[0]]}
        onConnect={vi.fn()}
      />,
    )
    expect(screen.getByText('Ctrl+F to star')).toBeInTheDocument()
  })

  it('closes from Escape and the backdrop', () => {
    const onClose = vi.fn()
    const { container } = renderPalette({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(container.querySelector('.bg-black\\/50') as Element)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
