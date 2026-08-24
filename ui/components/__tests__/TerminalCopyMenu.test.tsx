/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockOmnitermAPI } from '../../testUtils'
import TerminalCopyMenu from '../TerminalCopyMenu'

const lastListener = vi.fn()

beforeEach(() => {
  mockOmnitermAPI({})
  window.addEventListener('omniterm:copy-terminal', lastListener)
  return () => window.removeEventListener('omniterm:copy-terminal', lastListener)
})

describe('TerminalCopyMenu', () => {
  it('opens a dropdown with both copy actions', () => {
    render(<TerminalCopyMenu sessionId="s1" />)
    const open = screen.getByRole('button', { name: 'Copy terminal output' })
    expect(screen.queryByRole('menuitem', { name: /Copy last output/ })).not.toBeInTheDocument()
    fireEvent.click(open)
    expect(screen.getByRole('menu', { name: 'Copy terminal output' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Copy last output/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Copy all terminal/ })).toBeInTheDocument()
  })

  it('dispatches a last-output request and closes on selection', async () => {
    render(<TerminalCopyMenu sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy terminal output' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy last output/ }))
    await waitFor(() => expect(lastListener).toHaveBeenCalled())
    const detail = (lastListener.mock.calls.at(-1)?.[0] as CustomEvent).detail
    expect(detail).toEqual({ sessionId: 's1', action: 'last-output' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('dispatches a viewport request for "Copy all terminal"', async () => {
    render(<TerminalCopyMenu sessionId="s2" placement="top" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy terminal output' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy all terminal/ }))
    await waitFor(() => expect(lastListener).toHaveBeenCalled())
    const detail = (lastListener.mock.calls.at(-1)?.[0] as CustomEvent).detail
    expect(detail).toEqual({ sessionId: 's2', action: 'viewport' })
  })

  it('closes on Escape', () => {
    render(<TerminalCopyMenu sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy terminal output' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on outside mousedown', () => {
    render(<TerminalCopyMenu sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy terminal output' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders as an overflow menu item when menuItem is set', () => {
    render(<TerminalCopyMenu sessionId="s1" menuItem />)
    const item = screen.getByRole('menuitem', { name: /Copy terminal output/ })
    expect(item).toHaveTextContent('Copy terminal output')
    expect(screen.queryByRole('button', { name: 'Copy terminal output' })).not.toBeInTheDocument()
  })
})
