/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkspaceSearchBar from '../WorkspaceSearchBar'

describe('WorkspaceSearchBar', () => {
  it('is a single icon until it is clicked, then an input', () => {
    render(<WorkspaceSearchBar query="" onChange={vi.fn()} />)
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    expect(screen.getByLabelText('Search workspace').tagName).toBe('BUTTON')

    fireEvent.click(screen.getByLabelText('Search workspace'))
    // The title gives up the line: at 180px there is no room for both.
    expect(screen.queryByText('Workspaces')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Search workspace').tagName).toBe('INPUT')
  })

  it('opens on the hotkey and focuses the input', () => {
    render(<WorkspaceSearchBar query="" onChange={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true })
    const input = screen.getByLabelText('Search workspace')
    expect(input.tagName).toBe('INPUT')
    expect(document.activeElement).toBe(input)
  })

  it('clears the query when it closes, so the tree is not left filtered by a hidden box', () => {
    const onChange = vi.fn()
    render(<WorkspaceSearchBar query="go.sh" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Search workspace'))
    fireEvent.keyDown(screen.getByLabelText('Search workspace'), { key: 'Escape' })

    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
  })

  /** Blurring to reach the results must not close the box; blurring an empty one should. */
  it('stays open on blur while it holds a query', () => {
    const { rerender } = render(<WorkspaceSearchBar query="go" onChange={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Search workspace'))
    fireEvent.blur(screen.getByLabelText('Search workspace'))
    expect(screen.getByLabelText('Search workspace').tagName).toBe('INPUT')

    rerender(<WorkspaceSearchBar query="" onChange={vi.fn()} />)
    fireEvent.blur(screen.getByLabelText('Search workspace'))
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
  })
})
