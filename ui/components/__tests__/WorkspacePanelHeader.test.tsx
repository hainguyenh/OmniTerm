/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WorkspacePanelHeader from '../WorkspacePanelHeader'

describe('WorkspacePanelHeader', () => {
  it('creates a named empty workspace from the inline form', () => {
    const onCreate = vi.fn()
    render(
      <WorkspacePanelHeader
        query="" onQueryChange={vi.fn()} onImport={vi.fn()} onAdd={vi.fn()} onCreate={onCreate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Workspace name' }), { target: { value: 'Monorepo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

    expect(onCreate).toHaveBeenCalledWith('Monorepo')
    expect(screen.queryByRole('textbox', { name: 'Workspace name' })).not.toBeInTheDocument()
  })
})
