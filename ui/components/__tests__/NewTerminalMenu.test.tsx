/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Workspace } from '@omniterm/contract'
import type { ShellOption } from '../../shellOptions'
import NewTerminalMenu from '../NewTerminalMenu'

// jsdom implements neither scrollIntoView; mirror commandPalette.coverage.test.tsx.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })
})

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
    defaultShellId: 'powershell',
    onSelectWorkspace: vi.fn(),
    onLaunchShell: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  return { ...render(<NewTerminalMenu {...props} />), props }
}

describe('NewTerminalMenu', () => {
  it('marks the default shell and starts the keyboard cursor on it', () => {
    const { container } = renderMenu()

    const search = screen.getByRole('searchbox', { name: 'Search workspace or folder' })
    const defaultRow = screen.getByRole('option', { name: /PowerShell 7 \(default\)/ })
    expect(screen.queryByRole('option', { name: /Command Prompt \(default\)/ })).not.toBeInTheDocument()
    expect(container.ownerDocument.getElementById('new-terminal-item-3')).toBe(defaultRow)
    expect(search).toHaveAttribute('aria-activedescendant', 'new-terminal-item-3')
  })

  it('falls back to the first row when the default shell is not offered', () => {
    renderMenu({ defaultShellId: 'missing-shell' })

    const search = screen.getByRole('searchbox', { name: 'Search workspace or folder' })
    expect(search).toHaveAttribute('aria-activedescendant', 'new-terminal-item-0')
  })

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

    fireEvent.click(screen.getByRole('option', { name: /PowerShell 7/ }))

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

  it('moves the cursor with arrow keys and mouse hover, wrapping at both ends', () => {
    renderMenu()
    const search = screen.getByRole('searchbox', { name: 'Search workspace or folder' })

    fireEvent.keyDown(window, { key: 'ArrowUp' }) // from powershell (3) up to Docs - Guide (2)
    expect(search).toHaveAttribute('aria-activedescendant', 'new-terminal-item-2')

    fireEvent.mouseEnter(screen.getByRole('option', { name: /Team - Client/ }))
    expect(search).toHaveAttribute('aria-activedescendant', 'new-terminal-item-1')

    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'ArrowUp' }) // wraps past the first row to the last shell (4)
    expect(search).toHaveAttribute('aria-activedescendant', 'new-terminal-item-4')

    fireEvent.keyDown(window, { key: 'ArrowDown' }) // and back across the bottom boundary to None (0)
    expect(search).toHaveAttribute('aria-activedescendant', 'new-terminal-item-0')
  })

  it('moves the cursor when ArrowDown bubbles from the focused search input to window', () => {
    // The other suites fire keydown straight at `window`, skipping the real propagation chain
    // (input -> body -> html -> document -> window). This pins that chain end-to-end.
    renderMenu()
    const search = screen.getByRole('searchbox', { name: 'Search workspace or folder' })
    expect(document.activeElement).toBe(search)

    act(() => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    })

    // powershell (3) -> cmd (4)
    expect(search).toHaveAttribute('aria-activedescendant', 'new-terminal-item-4')
  })

  it('launches the shell under the cursor on Enter and closes', () => {
    const { props } = renderMenu({ defaultShellId: 'cmd' })

    fireEvent.keyDown(window, { key: 'Enter' }) // cursor starts on cmd (default)

    expect(props.onLaunchShell).toHaveBeenCalledWith('cmd')
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('opens the highlighted folder with the default shell on Enter and closes', () => {
    const { props } = renderMenu()

    fireEvent.keyDown(window, { key: 'ArrowUp' }) // powershell -> Docs - Guide
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(props.onSelectWorkspace).toHaveBeenCalledWith('docs::guide')
    expect(props.onLaunchShell).toHaveBeenCalledWith('powershell', 'docs::guide')
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('opens the None row as the default directory on Enter', () => {
    const { props } = renderMenu({ defaultShellId: 'cmd' })

    fireEvent.keyDown(window, { key: 'ArrowUp' }) // cmd (4) -> powershell (3)
    fireEvent.keyDown(window, { key: 'ArrowUp' }) // -> Docs - Guide (2)
    fireEvent.keyDown(window, { key: 'ArrowUp' }) // -> Team - Client (1)
    fireEvent.keyDown(window, { key: 'ArrowUp' }) // -> None (0)
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(props.onSelectWorkspace).toHaveBeenCalledWith(null)
    expect(props.onLaunchShell).toHaveBeenCalledWith('cmd', null)
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('resets the cursor to the first visible row when the query changes', () => {
    renderMenu()
    const search = screen.getByRole('searchbox', { name: 'Search workspace or folder' })

    fireEvent.change(search, { target: { value: 'guide' } })

    expect(search).toHaveAttribute('aria-activedescendant', 'new-terminal-item-0')
  })

  it('navigates shells only when no folder matches the filter', () => {
    const { props } = renderMenu()
    const search = screen.getByRole('searchbox', { name: 'Search workspace or folder' })
    fireEvent.change(search, { target: { value: 'zzz-no-match' } })

    fireEvent.keyDown(window, { key: 'ArrowDown' }) // None (0) -> powershell (1)
    expect(search).toHaveAttribute('aria-activedescendant', 'new-terminal-item-1')

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(props.onLaunchShell).toHaveBeenCalledWith('powershell')
  })
})
