/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkspaceSearchBar, { SEARCH_HINT } from '../WorkspaceSearchBar'

const input = () => screen.getByLabelText('Search workspace')

describe('WorkspaceSearchBar', () => {
  it('is always an input that names what it searches and its hotkey', () => {
    render(<WorkspaceSearchBar query="" onChange={vi.fn()} />)
    expect(input().tagName).toBe('INPUT')
    expect(input()).toHaveAttribute('title', SEARCH_HINT)
    expect(input()).toHaveAttribute('placeholder', 'Find in workspace…')
    expect(screen.queryByRole('button', { name: 'Clear search (Esc)' })).not.toBeInTheDocument()
  })

  it('focuses the input on the hotkey', () => {
    render(<WorkspaceSearchBar query="" onChange={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true })
    expect(document.activeElement).toBe(input())
  })

  it('clears the query on Escape without letting the key close anything else', () => {
    const onChange = vi.fn()
    const outer = vi.fn()
    render(<div onKeyDown={outer}><WorkspaceSearchBar query="go.sh" onChange={onChange} /></div>)
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(onChange).toHaveBeenCalledWith('')
    expect(outer).not.toHaveBeenCalled()
  })

  it('offers a clear button while it holds a query and refocuses the input', () => {
    const onChange = vi.fn()
    render(<WorkspaceSearchBar query="go" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear search (Esc)' }))
    expect(onChange).toHaveBeenCalledWith('')
    expect(document.activeElement).toBe(input())
  })
})
