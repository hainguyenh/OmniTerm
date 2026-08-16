/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Button } from '../Button'

describe('Button', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders standard Button with text and triggers click', () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Save</Button>)

    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('renders Button with tooltip and shows tooltip on hover', () => {
    render(
      <Button tooltip="Save your changes" tooltipDelay={100}>
        Save
      </Button>,
    )

    const btn = screen.getByRole('button', { name: 'Save' })
    fireEvent.mouseEnter(btn)

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(screen.getByRole('tooltip')).toHaveTextContent('Save your changes')
  })

  it('supports disabled state without tooltip triggers', () => {
    render(
      <Button disabled tooltip="Disabled button" tooltipDelay={0}>
        Disabled
      </Button>,
    )

    const btn = screen.getByRole('button', { name: 'Disabled' })
    expect(btn).toBeDisabled()
    fireEvent.mouseEnter(btn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
