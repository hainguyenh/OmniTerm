/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import TerminalLinkMenu from '../TerminalLinkMenu'

afterEach(() => {
  cleanup()
})

describe('TerminalLinkMenu — URL', () => {
  it('renders Copy Link and Open Link items only', () => {
    render(
      <TerminalLinkMenu
        x={100} y={100} kind="url" text="https://example.test/x" isLocal
        onCopyText={vi.fn()} onOpenUrl={vi.fn()} onOpenPath={vi.fn()} onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Copy Link')).toBeInTheDocument()
    expect(screen.getByText('Open Link')).toBeInTheDocument()
    expect(screen.queryByText('Copy Path')).toBeNull()
    expect(screen.queryByText('Open in OS')).toBeNull()
  })

  it('copy calls onCopyText with the link and closes', () => {
    const onCopyText = vi.fn()
    const onClose = vi.fn()
    render(
      <TerminalLinkMenu
        x={0} y={0} kind="url" text="https://example.test/x" isLocal
        onCopyText={onCopyText} onOpenUrl={vi.fn()} onOpenPath={vi.fn()} onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('Copy Link'))
    expect(onCopyText).toHaveBeenCalledWith('https://example.test/x')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('open calls onOpenUrl with the URL and closes', () => {
    const onOpenUrl = vi.fn()
    const onClose = vi.fn()
    render(
      <TerminalLinkMenu
        x={0} y={0} kind="url" text="https://example.test/x" isLocal
        onCopyText={vi.fn()} onOpenUrl={onOpenUrl} onOpenPath={vi.fn()} onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('Open Link'))
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.test/x')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalLinkMenu — Path', () => {
  it('renders both Copy Path and Open in OS when isLocal is true', () => {
    render(
      <TerminalLinkMenu
        x={100} y={100} kind="path" text="/home/me/file.txt" isLocal
        onCopyText={vi.fn()} onOpenUrl={vi.fn()} onOpenPath={vi.fn()} onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Copy Path')).toBeInTheDocument()
    expect(screen.getByText('Open in OS')).toBeInTheDocument()
  })

  it('hides Open in OS when isLocal is false (remote pane)', () => {
    render(
      <TerminalLinkMenu
        x={100} y={100} kind="path" text="/home/me/file.txt" isLocal={false}
        onCopyText={vi.fn()} onOpenUrl={vi.fn()} onOpenPath={vi.fn()} onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Copy Path')).toBeInTheDocument()
    expect(screen.queryByText('Open in OS')).toBeNull()
  })

  it('Open in OS calls onOpenPath and closes', () => {
    const onOpenPath = vi.fn()
    const onClose = vi.fn()
    render(
      <TerminalLinkMenu
        x={0} y={0} kind="path" text="C:/Users/me/file.txt" isLocal
        onCopyText={vi.fn()} onOpenUrl={vi.fn()} onOpenPath={onOpenPath} onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('Open in OS'))
    expect(onOpenPath).toHaveBeenCalledWith('C:/Users/me/file.txt')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalLinkMenu — close behaviour', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <TerminalLinkMenu
        x={0} y={0} kind="url" text="https://example.test/x" isLocal
        onCopyText={vi.fn()} onOpenUrl={vi.fn()} onOpenPath={vi.fn()} onClose={onClose}
      />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when a click lands outside the menu', () => {
    const onClose = vi.fn()
    render(
      <TerminalLinkMenu
        x={0} y={0} kind="url" text="https://example.test/x" isLocal
        onCopyText={vi.fn()} onOpenUrl={vi.fn()} onOpenPath={vi.fn()} onClose={onClose}
      />,
    )
    fireEvent.mouseDown(document.body, { clientX: 999, clientY: 999 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close when a click lands inside the menu', () => {
    const onClose = vi.fn()
    render(
      <TerminalLinkMenu
        x={0} y={0} kind="url" text="https://example.test/x" isLocal
        onCopyText={vi.fn()} onOpenUrl={vi.fn()} onOpenPath={vi.fn()} onClose={onClose}
      />,
    )
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
