/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AwakeStripeButton } from '../AwakeStripeButton'
import { OPEN_ALWAYS_AWAKE_EVENT, publishAwakeIndicator, useAwakeIndicator } from '../awakeIndicatorStore'

afterEach(() => {
  cleanup()
  act(() => publishAwakeIndicator({ available: false, enabled: false, keepingAwake: false }))
})

describe('AwakeStripeButton', () => {
  it('stays hidden while the feature is off in Plugins, and on the left stripe', () => {
    const { rerender } = render(<AwakeStripeButton side="right" />)
    expect(screen.queryByTestId('awake-stripe-button')).toBeNull()
    act(() => publishAwakeIndicator({ available: true, enabled: false, keepingAwake: false }))
    rerender(<AwakeStripeButton side="left" />)
    expect(screen.queryByTestId('awake-stripe-button')).toBeNull()
  })

  it('names its state and opens the dialog through the window event', () => {
    act(() => publishAwakeIndicator({ available: true, enabled: false, keepingAwake: false }))
    render(<AwakeStripeButton side="right" />)
    const button = screen.getByRole('button', { name: 'Always Awake' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    const open = vi.fn()
    window.addEventListener(OPEN_ALWAYS_AWAKE_EVENT, open)
    fireEvent.click(button)
    window.removeEventListener(OPEN_ALWAYS_AWAKE_EVENT, open)
    expect(open).toHaveBeenCalledTimes(1)
    act(() => publishAwakeIndicator({ available: true, enabled: true, keepingAwake: false }))
    expect(screen.getByRole('button', { name: 'Always Awake (waiting)' }).getAttribute('aria-pressed')).toBe('true')
    act(() => publishAwakeIndicator({ available: true, enabled: true, keepingAwake: true }))
    const active = screen.getByRole('button', { name: 'Always Awake (active)' })
    expect(active.querySelector('.omt-awake-stripe-dot')).not.toBeNull()
  })

  it('publishing the same state again does not notify the store', () => {
    act(() => publishAwakeIndicator({ available: true, enabled: true, keepingAwake: false }))
    const listener = vi.fn()
    const unsubscribe = useAwakeIndicator.subscribe(listener)
    publishAwakeIndicator({ available: true, enabled: true, keepingAwake: false })
    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })
})
