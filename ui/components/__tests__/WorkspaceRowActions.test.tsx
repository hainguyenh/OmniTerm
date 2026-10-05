/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { Pencil, Trash2 } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useRowContextMenu } from '../useRowContextMenu'
import { WorkspaceRowActions } from '../WorkspaceRowActions'

function Row({ onRename = vi.fn() }: { onRename?: () => void }) {
  const { actionsRef, onContextMenu } = useRowContextMenu()
  return (
    <div data-testid="row" onContextMenu={onContextMenu}>
      <WorkspaceRowActions ref={actionsRef} label="Actions for row" items={[
        { label: 'Rename', icon: Pencil, onSelect: onRename },
        { label: 'Delete', icon: Trash2, onSelect: vi.fn(), danger: true },
      ]} />
    </div>
  )
}

const trigger = () => screen.getByRole('button', { name: 'Actions for row' })

describe('WorkspaceRowActions', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens under its trigger for the context-menu key, which reports no pointer', () => {
    render(<Row />)
    vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 100, 20, 20))
    fireEvent.contextMenu(screen.getByTestId('row'), { clientX: 0, clientY: 0 })
    const menu = screen.getByRole('menu', { name: 'Actions for row' })
    expect(menu.style.top).toBe('124px')
    expect(menu.style.left).toBe(`${Math.max(8, 320 - 248)}px`)
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps a right-click menu inside the viewport', () => {
    render(<Row />)
    fireEvent.contextMenu(screen.getByTestId('row'), { clientX: window.innerWidth - 4, clientY: 10 })
    const menu = screen.getByRole('menu', { name: 'Actions for row' })
    expect(menu.style.left).toBe(`${window.innerWidth - 248 - 8}px`)
  })

  it('moves focus with the arrow keys and returns it to the trigger on Escape', () => {
    render(<Row />)
    fireEvent.contextMenu(screen.getByTestId('row'), { clientX: 20, clientY: 20 })
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('closes on an outside pointer press and runs the chosen action once', () => {
    const onRename = vi.fn()
    render(<Row onRename={onRename} />)
    fireEvent.contextMenu(screen.getByTestId('row'), { clientX: 20, clientY: 20 })
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(onRename).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
