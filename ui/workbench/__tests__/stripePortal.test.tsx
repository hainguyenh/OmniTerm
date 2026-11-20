/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StripePortal } from '../StripePortal'

describe('StripePortal', () => {
  // Regression: the layout picker was appended below the stripe's bottom group, under the
  // Notifications button; it belongs right above that group.
  it('sits between the stripe spacer and its bottom group of buttons', () => {
    render(
      <>
        <nav data-stripe-side="right">
          <div data-stripe-slot="right" />
          <div data-stripe-spacer="" />
          <div data-stripe-slot="bottom-right" data-testid="lower" />
        </nav>
        <StripePortal side="right">
          <button type="button">Layout</button>
        </StripePortal>
      </>,
    )
    const host = screen.getByRole('button', { name: 'Layout' }).parentElement!
    expect(host.previousElementSibling?.hasAttribute('data-stripe-spacer')).toBe(true)
    expect(host.nextElementSibling).toBe(screen.getByTestId('lower'))
  })

  // Regression: the layout picker was put low on the stripe; it belongs above Notifications, the
  // stripe's first button.
  it('sits above the first group of buttons when placed at the top', () => {
    render(
      <>
        <nav data-stripe-side="right">
          <div data-stripe-slot="right" data-testid="first" />
          <div data-stripe-spacer="" />
        </nav>
        <StripePortal side="right" at="top">
          <button type="button">Layout</button>
        </StripePortal>
      </>,
    )
    const host = screen.getByRole('button', { name: 'Layout' }).parentElement!
    expect(host.previousElementSibling).toBeNull()
    expect(host.nextElementSibling).toBe(screen.getByTestId('first'))
  })

  // Regression: the host's own padding and gap spaced the layout picker further from the
  // Notifications button than the stripe spaces its buttons.
  it('adds no spacing of its own to the stripe', () => {
    render(
      <>
        <nav data-stripe-side="right" />
        <StripePortal side="right" at="top">
          <button type="button">Layout</button>
        </StripePortal>
      </>,
    )
    const host = screen.getByRole('button', { name: 'Layout' }).parentElement!
    expect(host.style.display).toBe('contents')
    expect(host.style.padding).toBe('')
    expect(host.style.gap).toBe('')
  })
})
