/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AlwaysAwakeModal from './AlwaysAwakeModal'
import { defaultCustomExpiry, endOfToday, fromLocalInput, scheduleFromStatus, toLocalInput } from './awakeSchedule'
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
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(onClose).toHaveBeenCalled()
  })

  it('computes an expiry for each schedule', async () => {
    const setState = vi.fn(async (_payload: { enabled: boolean; mode: AlwaysAwakeMode; expiresAtMs: number }) => status)
    mockOmnitermAPI({ alwaysAwake: { setState } })
    render(<AlwaysAwakeModal status={status} onClose={vi.fn()} onSaved={vi.fn()} />)

    const expiryFor = async (label: string) => {
      fireEvent.click(screen.getByRole('button', { name: label }))
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(setState).toHaveBeenCalled())
      return setState.mock.calls.at(-1)![0].expiresAtMs
    }

    expect(await expiryFor('Today')).toBe(endOfToday())

    // Custom starts at 08:00 tomorrow.
    const custom = await expiryFor('Custom')
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(new Date(custom).getDate()).toBe(tomorrow.getDate())
    expect([new Date(custom).getHours(), new Date(custom).getMinutes()]).toEqual([8, 0])

    // …and the user can set their own.
    const later = new Date()
    later.setDate(later.getDate() + 3)
    later.setHours(18, 30, 0, 0)
    fireEvent.change(screen.getByLabelText('Keep awake until'), { target: { value: toLocalInput(later.getTime()) } })
    expect(await expiryFor('Custom')).toBe(later.getTime())
  })

  it('refuses a custom time that is not in the future', () => {
    const setState = vi.fn(async () => status)
    mockOmnitermAPI({ alwaysAwake: { setState } })
    render(<AlwaysAwakeModal status={status} onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Keep awake until'), { target: { value: toLocalInput(Date.now() - 3_600_000) } })
    expect(screen.getByText('Pick a time in the future.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Always Awake' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Keep awake until'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(setState).not.toHaveBeenCalled()
  })

  it('shows a failure from the backend instead of closing', async () => {
    const onClose = vi.fn()
    mockOmnitermAPI({
      alwaysAwake: {
        setState: vi.fn(async () => { throw new Error('Windows rejected the sleep-prevention request.') }),
        disable: vi.fn(async () => { throw new Error('disable failed') }),
      },
    })
    render(<AlwaysAwakeModal status={status} onClose={onClose} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText(/rejected the sleep-prevention/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    await waitFor(() => expect(screen.getByText(/disable failed/)).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes from Escape, the X and the backdrop, and reports a backend error carried in the status', () => {
    const onClose = vi.fn()
    const { container, unmount } = render(
      <AlwaysAwakeModal status={{ ...status, error: 'Windows did not return the active sleep timeout.' }} onClose={onClose} onSaved={vi.fn()} />,
    )
    expect(screen.getByText(/did not return the active sleep timeout/)).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTitle('Close'))
    fireEvent.click(container.firstElementChild as Element)
    expect(onClose).toHaveBeenCalledTimes(3)
    unmount()
  })

  it('reports the live keep-awake state and the sessions holding it open', () => {
    const { rerender } = render(
      <AlwaysAwakeModal status={{ ...status, enabled: true, keepingAwake: true, activeSessionCount: 2 }} onClose={vi.fn()} onSaved={vi.fn()} />,
    )
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText(/2 active sessions/)).toBeInTheDocument()

    rerender(<AlwaysAwakeModal status={{ ...status, enabled: true, activeSessionCount: 1 }} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('Enabled, waiting')).toBeInTheDocument()
    expect(screen.getByText(/1 active session$/)).toBeInTheDocument()
  })

  it('states ON or OFF in its own right, not only as a colour', () => {
    const { rerender } = render(<AlwaysAwakeModal status={status} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent(/Always Awake is OFF/)
    expect(screen.getByRole('switch', { name: 'Always Awake' })).toHaveAttribute('aria-checked', 'false')

    rerender(<AlwaysAwakeModal status={{ ...status, enabled: true, keepingAwake: true }} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent(/Always Awake is ON/)
    expect(screen.getByRole('switch', { name: 'Always Awake' })).toHaveAttribute('aria-checked', 'true')
  })

  it('flips the switch to apply the selected schedule immediately, or to disable', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    const enabled = { ...status, enabled: true, expiresAtMs: Date.now() + 1_000 }
    const setState = vi.fn(async () => enabled)
    mockOmnitermAPI({ alwaysAwake: { setState, disable: vi.fn(async () => status) } })
    const { rerender } = render(
      <AlwaysAwakeModal status={status} onClose={onClose} onSaved={onSaved} />,
    )

    // Off -> On applies the current mode/schedule without touching Save.
    fireEvent.click(screen.getByRole('switch', { name: 'Always Awake' }))
    await waitFor(() => expect(setState).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, mode: 'activeOnly' })))
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    // On -> Off disables immediately.
    onClose.mockClear()
    rerender(<AlwaysAwakeModal status={enabled} onClose={onClose} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Always Awake' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(status))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('opens on the schedule that is actually running, not always on its default', () => {
    // Reopening used to reset the group to its default, so the panel claimed a schedule the
    // machine was not keeping.
    const { unmount } = render(
      <AlwaysAwakeModal status={{ ...status, enabled: true, expiresAtMs: endOfToday() }} onClose={vi.fn()} onSaved={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('Keep awake until')).toBeNull()
    unmount()

    const custom = fromLocalInput(toLocalInput(Date.now() + 5 * 86_400_000))
    render(<AlwaysAwakeModal status={{ ...status, enabled: true, expiresAtMs: custom }} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Keep awake until')).toHaveValue(toLocalInput(custom))
  })

  it('classifies a stored deadline back into the schedule that produced it', () => {
    const now = Date.now()
    const tomorrowAt8 = defaultCustomExpiry()
    const custom = now + 2 * 86_400_000

    expect(scheduleFromStatus({ ...status, enabled: true, expiresAtMs: endOfToday() }, now)).toEqual({ duration: 'today', customAt: tomorrowAt8 })
    expect(scheduleFromStatus({ ...status, enabled: true, expiresAtMs: custom }, now)).toEqual({ duration: 'custom', customAt: custom })
    // Nothing running (off, lapsed, or never set): Custom at its 08:00-tomorrow default.
    for (const stored of [{ enabled: false, expiresAtMs: custom }, { enabled: true, expiresAtMs: now - 1 }, { enabled: true, expiresAtMs: 0 }]) {
      expect(scheduleFromStatus({ ...status, ...stored }, now)).toEqual({ duration: 'custom', customAt: tomorrowAt8 })
    }
  })

  it('shows the deadline each schedule resolves to, and updates it on selection', () => {
    render(<AlwaysAwakeModal status={status} onClose={vi.fn()} onSaved={vi.fn()} />)
    const deadline = () => screen.getByText(/^Until /).textContent

    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true')
    const asCustom = deadline()
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(deadline()).not.toBe(asCustom)
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
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
