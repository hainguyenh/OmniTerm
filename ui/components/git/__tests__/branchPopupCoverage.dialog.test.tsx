/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GitBranchUpdateDialog } from '../GitBranchUpdateDialog'
import type { GitBranchInfo } from '../gitTypes'

const topic: GitBranchInfo = {
  name: 'topic',
  is_current: false,
  is_remote: false,
  upstream: 'origin/topic',
  ahead: 0,
  behind: 1,
  is_gone: false,
}

describe('GitBranchUpdateDialog interactions', () => {
  it('closes on Escape and from the backdrop, but not from inside the dialog', () => {
    const onClose = vi.fn()
    render(<GitBranchUpdateDialog branch={topic} onUpdate={vi.fn()} onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: 'Update topic without checkout' })
    expect(dialog).toHaveTextContent('Your working branch stays on HEAD.')
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(dialog.parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('focuses the first control and traps Tab inside the dialog', () => {
    const outsideKeyDown = vi.fn()
    render(
      <div onKeyDown={outsideKeyDown}>
        <GitBranchUpdateDialog branch={topic} currentBranch="main" onUpdate={vi.fn()} onClose={vi.fn()} />
      </div>,
    )

    const close = screen.getByRole('button', { name: 'Close update dialog' })
    const update = screen.getByRole('button', { name: /Update topic/ })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(close).toHaveFocus()

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(update).toHaveFocus()
    fireEvent.keyDown(update, { key: 'Tab' })
    expect(close).toHaveFocus()

    cancel.focus()
    fireEvent.keyDown(cancel, { key: 'Tab' })
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(cancel).toHaveFocus()
    expect(outsideKeyDown).not.toHaveBeenCalled()
  })

  it('disables the update while it runs and clears an earlier refusal', async () => {
    let resolveUpdate: (value: string | null) => void = () => undefined
    const onUpdate = vi.fn()
      .mockResolvedValueOnce('diverged')
      .mockImplementationOnce(() => new Promise<string | null>((resolve) => { resolveUpdate = resolve }))
    const onClose = vi.fn()
    render(<GitBranchUpdateDialog branch={topic} onUpdate={onUpdate} onClose={onClose} />)

    const update = screen.getByRole('button', { name: /Update topic/ })
    await act(async () => { fireEvent.click(update) })
    expect(screen.getByRole('alert')).toHaveTextContent('diverged')

    await act(async () => { fireEvent.click(update) })
    expect(update).toBeDisabled()
    expect(update.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => { resolveUpdate(null) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores focus to the opener when it unmounts', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<GitBranchUpdateDialog branch={topic} onUpdate={vi.fn()} onClose={vi.fn()} />)
    expect(opener).not.toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('does not return focus to a non-HTML element', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('tabindex', '0')
    document.body.appendChild(svg)
    svg.focus()
    const { unmount } = render(<GitBranchUpdateDialog branch={topic} onUpdate={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Close update dialog' })).toHaveFocus()
    unmount()
    expect(svg).not.toHaveFocus()
    svg.remove()
  })
})
