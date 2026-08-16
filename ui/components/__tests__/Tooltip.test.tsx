/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Tooltip } from '../Tooltip'

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Default window dimensions
    window.innerWidth = 1024
    window.innerHeight = 768
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders trigger element normally and shows tooltip on hover after delay', () => {
    render(
      <Tooltip content="Helpful tooltip" delay={100}>
        <button type="button">Action</button>
      </Tooltip>,
    )

    const btn = screen.getByRole('button', { name: 'Action' })
    expect(btn).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.mouseEnter(btn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(100)
    })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('Helpful tooltip')

    fireEvent.mouseLeave(btn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows tooltip on focus and hides on blur', () => {
    render(
      <Tooltip content="Focus tooltip" delay={50}>
        <button type="button">Focusable</button>
      </Tooltip>,
    )

    const btn = screen.getByRole('button', { name: 'Focusable' })
    fireEvent.focus(btn)

    act(() => {
      vi.advanceTimersByTime(50)
    })

    expect(screen.getByRole('tooltip')).toHaveTextContent('Focus tooltip')

    fireEvent.blur(btn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('closes on click or escape key', () => {
    render(
      <Tooltip content="Dismissible" delay={0}>
        <button type="button">Click me</button>
      </Tooltip>,
    )

    const btn = screen.getByRole('button', { name: 'Click me' })
    fireEvent.mouseEnter(btn)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.mouseEnter(btn)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.click(btn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('flips placement from bottom to top when near viewport bottom', () => {
    render(
      <Tooltip content="Bottom collision" delay={0} placement="bottom">
        <button type="button">Bottom Button</button>
      </Tooltip>,
    )

    const btn = screen.getByRole('button', { name: 'Bottom Button' })

    // Simulate button placed near bottom edge of screen (y = 750 in 768px height)
    vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({
      top: 740,
      bottom: 760,
      left: 100,
      right: 150,
      width: 50,
      height: 20,
      x: 100,
      y: 740,
      toJSON: () => {},
    })

    fireEvent.mouseEnter(btn)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    // Flipped above the anchor: a failed flip would clamp the tooltip to the bottom edge
    // (top ≥ 740); a successful one positions it above the button's top.
    expect(Number.parseFloat(tooltip.style.top)).toBeLessThan(740)
  })

  it('does not render tooltip portal when content is empty or null', () => {
    render(
      <Tooltip content={null}>
        <button type="button">No tooltip</button>
      </Tooltip>,
    )

    const btn = screen.getByRole('button', { name: 'No tooltip' })
    fireEvent.mouseEnter(btn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders retro keycaps when shortcut is embedded in content', () => {
    render(
      <Tooltip content="New Terminal (Ctrl+N)" delay={0}>
        <button type="button">New Tab</button>
      </Tooltip>,
    )

    const btn = screen.getByRole('button', { name: 'New Tab' })
    fireEvent.mouseEnter(btn)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('New Terminal')
    expect(tooltip).toHaveTextContent('Ctrl')
    expect(tooltip).toHaveTextContent('N')
    expect(screen.getByTestId('keycap-combo')).toBeInTheDocument()
  })

  it('renders retro keycaps when shortcut is passed explicitly', () => {
    render(
      <Tooltip content="Split 2" shortcut="Ctrl+2" delay={0}>
        <button type="button">Split</button>
      </Tooltip>,
    )

    const btn = screen.getByRole('button', { name: 'Split' })
    fireEvent.mouseEnter(btn)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('Split 2')
    expect(tooltip).toHaveTextContent('-')
    expect(tooltip).toHaveTextContent('Ctrl')
    expect(tooltip).toHaveTextContent('2')
  })
})
