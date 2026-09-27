/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RenewSessionModal } from '../RenewSessionModal'

describe('RenewSessionModal', () => {
  it('renders default reopen strategy with title, session name and description', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <RenewSessionModal
        sessionName="claude-code (tab 1)"
        strategy="reopen"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText('Renew Session')).toBeInTheDocument()
    expect(screen.getByText('claude-code (tab 1)')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Terminate the current session process tree and restart the AI agent profile in the current directory?',
      ),
    ).toBeInTheDocument()
  })

  it('renders new-command strategy description', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <RenewSessionModal
        strategy="new-command"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(
      screen.getByText(
        'Send the "/new" command to start a fresh conversation session with the active AI agent?',
      ),
    ).toBeInTheDocument()
  })

  it('calls onCancel when Cancel button is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(<RenewSessionModal onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.click(screen.getByTestId('renew-session-cancel-button'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onCancel when Escape key is pressed', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(<RenewSessionModal onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onConfirm with false when remember is unchecked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(<RenewSessionModal onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.click(screen.getByTestId('renew-session-confirm-button'))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('calls onConfirm with true when remember checkbox is toggled', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(<RenewSessionModal onConfirm={onConfirm} onCancel={onCancel} />)

    const checkbox = screen.getByTestId('renew-session-remember-checkbox')
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()

    fireEvent.click(screen.getByTestId('renew-session-confirm-button'))
    expect(onConfirm).toHaveBeenCalledWith(true)
  })
})
