/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@omniterm/contract'
import WorkspaceSelect from '../WorkspaceSelect'

const workspaces: Workspace[] = [
  { id: 'one', name: 'One', path: 'C:/one' },
  { id: 'two', name: 'Two', path: 'C:/two' },
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
})
