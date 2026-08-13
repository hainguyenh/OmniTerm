/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@omniterm/contract'
import WorkspaceSelect from '../WorkspaceSelect'

const workspaces: Workspace[] = [
  { id: 'one', name: 'One', folders: [{ id: 'f1', name: 'One', path: 'C:/one' }], order: 0, pins: [] },
  { id: 'two', name: 'Two', folders: [{ id: 'f2', name: 'Two', path: 'C:/two' }], order: 1, pins: [] },
]

describe('WorkspaceSelect', () => {
  it('opens nearby options and reports the selected workspace', () => {
    const onChange = vi.fn()
    render(<WorkspaceSelect workspaces={workspaces} value="one" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Terminal workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Two' }))

    expect(onChange).toHaveBeenCalledWith('two')
    expect(screen.queryByRole('button', { name: 'Two' })).not.toBeInTheDocument()
  })

  it('supports clearing the workspace selection', () => {
    const onChange = vi.fn()
    render(<WorkspaceSelect workspaces={workspaces} value="one" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Terminal workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'None' }))

    expect(onChange).toHaveBeenCalledWith(null)
  })
  it('keeps multi-folder containers visible but unavailable as an ambiguous terminal cwd', () => {
    const composite: Workspace = {
      id: 'multi', name: 'Composite', order: 0, pins: [],
      folders: [
        { id: 'f1', name: 'One', path: 'C:/one' },
        { id: 'f2', name: 'Two', path: 'D:/two' },
      ],
    }
    const onChange = vi.fn()
    render(<WorkspaceSelect workspaces={[composite, ...workspaces]} value={null} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Terminal workspace' }))
    const option = screen.getByRole('button', { name: 'Composite' })
    expect(option).toBeDisabled()
    expect(option).toHaveAttribute('title', 'Open a terminal from a folder in the Workspace panel')
    fireEvent.click(option)
    expect(onChange).not.toHaveBeenCalled()
  })

})
