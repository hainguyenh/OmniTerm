/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AlwaysAwakeModal from './AlwaysAwakeModal'
import { mockOmnitermAPI } from '../../../ui/testUtils'

const status: AlwaysAwakeStatus = {
  enabled: false,
  mode: 'activeOnly',
  expiresAtMs: 0,
  activeSessionCount: 0,
  keepingAwake: false,
  supported: true,
  error: null,
}

describe('AlwaysAwakeModal', () => {
  beforeEach(() => mockOmnitermAPI())

  it('selects mode with radio buttons, saves a duration, and closes', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    const saved = { ...status, enabled: true, mode: 'always' as const, expiresAtMs: Date.now() + 1_000 }
    mockOmnitermAPI({ alwaysAwake: { setState: vi.fn(async () => saved) } })
    render(<AlwaysAwakeModal status={status} onClose={onClose} onSaved={onSaved} />)

    expect(screen.getByRole('radio', { name: /While terminal work is active/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /Always during schedule/ }))
    expect(screen.getByRole('radio', { name: /Always during schedule/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Mon 08:00' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(onClose).toHaveBeenCalled()
  })

  it('turns the feature off and reports unsupported platforms', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    const disabled = { ...status }
    mockOmnitermAPI({ alwaysAwake: { disable: vi.fn(async () => disabled) } })
    render(<AlwaysAwakeModal status={{ ...status, supported: false }} onClose={onClose} onSaved={onSaved} />)

    expect(screen.getByText(/Windows only/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(disabled))
    expect(onClose).toHaveBeenCalled()
  })
})
