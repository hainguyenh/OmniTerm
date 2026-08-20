/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Workspace } from '@omniterm/contract'
import type { ShellOption } from '../../shellOptions'
import NewTerminalMenu from '../NewTerminalMenu'

const workspaces: Workspace[] = [
  {
    id: 'team',
    name: 'Team',
    folders: [{ id: 'client', name: 'Client', path: 'C:/repos/client-app' }],
    order: 0,
    pins: [],
  },
  {
    id: 'docs',
    name: 'Docs',
    folders: [{ id: 'guide', name: 'Guide', path: 'C:/docs/guide' }],
    order: 1,
    pins: [],
  },
]

const shellOptions: ShellOption[] = [
  { id: 'powershell', label: 'PowerShell 7' },
  { id: 'cmd', label: 'Command Prompt' },
]

function renderMenu(overrides: Partial<ComponentProps<typeof NewTerminalMenu>> = {}) {
  const props: ComponentProps<typeof NewTerminalMenu> = {
    anchor: { x: 100, y: 200 },
    shellOptions,
    workspaces,
    selectedWorkspaceId: 'team::client',
    onSelectWorkspace: vi.fn(),
    onLaunchShell: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  return { ...render(<NewTerminalMenu {...props} />), props }
}

describe('NewTerminalMenu', () => {
  it('focuses search and filters workspace/folder rows by name or path', () => {
    renderMenu()

    const search = screen.getByRole('searchbox', { name: 'Search workspace or folder' })
    expect(document.activeElement).toBe(search)
    fireEvent.change(search, { target: { value: 'client' } })

    expect(screen.getByRole('option', { name: /Team - Client/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Docs - Guide/ })).not.toBeInTheDocument()
  })

  it('updates workspace selection without closing the menu', () => {
    const { props } = renderMenu()

    fireEvent.click(screen.getByRole('option', { name: /Docs - Guide/ }))

    expect(props.onSelectWorkspace).toHaveBeenCalledWith('docs::guide')
    expect(screen.getByRole('searchbox', { name: 'Search workspace or folder' })).toBeInTheDocument()
  })

  it('starts a shell with the selected workspace and closes the menu', () => {
    const { props } = renderMenu()

    fireEvent.click(screen.getByRole('button', { name: 'PowerShell 7' }))

    expect(props.onLaunchShell).toHaveBeenCalledWith('powershell')
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('renders a bounded scroll container and closes on Escape', () => {
    const { props } = renderMenu()
    const menu = screen.getByTestId('new-terminal-menu')

    expect(menu).toHaveClass('max-h-[min(70vh,28rem)]', 'overflow-y-auto')
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search workspace or folder' }), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('limits the menu height to the available viewport space', () => {
    renderMenu({ anchor: { x: 100, y: 740 } })

    const menu = screen.getByTestId('new-terminal-menu')
    expect(menu).toHaveStyle({ bottom: '36px', maxHeight: '448px' })
    expect(menu.style.top).toBe('')
  })
})
