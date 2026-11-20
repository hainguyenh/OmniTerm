/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { diag } from '../../diag'
import { RootErrorBoundary } from '../RootErrorBoundary'

function Boom(): never {
  throw new Error('theme exploded')
}

describe('RootErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders its children while nothing fails', () => {
    render(<RootErrorBoundary><p>shell</p></RootErrorBoundary>)
    expect(screen.getByText('shell')).toBeTruthy()
  })

  it('shows a recovery screen instead of a blank window and reports the error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const report = vi.spyOn(diag, 'error').mockImplementation(() => {})
    const onReload = vi.fn()
    render(<RootErrorBoundary onReload={onReload}><Boom /></RootErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toContain('theme exploded')
    expect(report).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload window' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
