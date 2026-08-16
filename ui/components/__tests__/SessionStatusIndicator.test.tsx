/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SessionStatusIndicator from '../SessionStatusIndicator'

describe('SessionStatusIndicator', () => {
  it('renders nothing when status is null', () => {
    const { container } = render(<SessionStatusIndicator status={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders sonar ping running effect for active AI agent', () => {
    render(<SessionStatusIndicator status="connected" isAgent busy />)
    const indicator = screen.getByTitle('AI agent running')
    expect(indicator).toBeInTheDocument()
    expect(indicator.querySelector('.animate-ping')).toBeInTheDocument()
  })

  it('renders sonar ping running effect for running process', () => {
    render(<SessionStatusIndicator status="connected" busy />)
    const indicator = screen.getByTitle('Running command')
    expect(indicator).toBeInTheDocument()
    expect(indicator.querySelector('.animate-ping')).toBeInTheDocument()
  })

  it('renders connecting pulse indicator', () => {
    render(<SessionStatusIndicator status="connecting" />)
    const indicator = screen.getByTitle('Connecting…')
    expect(indicator).toBeInTheDocument()
    expect(indicator.querySelector('.animate-ping')).toBeInTheDocument()
  })

  it('renders idle indicator when connected and not busy', () => {
    render(<SessionStatusIndicator status="connected" busy={false} />)
    const indicator = screen.getByTitle('Idle')
    expect(indicator).toHaveClass('border-theme-dim')
    expect(indicator).toHaveClass('bg-transparent')
  })

  it('renders plain connected dot when busy is undefined', () => {
    render(<SessionStatusIndicator status="connected" />)
    const indicator = screen.getByTitle('Connected')
    expect(indicator).toHaveClass('bg-theme-accent')
  })

  it('renders disconnected and error dots correctly', () => {
    const { unmount } = render(<SessionStatusIndicator status="closed" />)
    expect(screen.getByTitle('Disconnected')).toBeInTheDocument()
    unmount()

    render(<SessionStatusIndicator status="error" />)
    expect(screen.getByTitle('Error')).toBeInTheDocument()
  })
})
