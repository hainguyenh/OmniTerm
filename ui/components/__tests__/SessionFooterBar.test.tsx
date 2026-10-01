/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { mockOmnitermAPI } from '../../testUtils'
import { recordPastedImage, releaseSessionMedia } from '../../utils/sessionAttachmentStore'
import { SessionFooterBar } from '../SessionFooterBar'

const local: Connection = {
  id: 'local', name: 'Local', type: 'LOCAL', host: '', port: '', user: '', localCwd: 'F:/repo',
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  releaseSessionMedia('s1')
  releaseSessionMedia('s2')
  mockOmnitermAPI({
    connect: {
      localInput: vi.fn(),
    },
  })
})

const renderFooter = (overrides: Partial<React.ComponentProps<typeof SessionFooterBar>> = {}) => {
  const props: React.ComponentProps<typeof SessionFooterBar> = {
    conn: local,
    sessionId: 's1',
    status: 'connected',
    latency: null,
    metrics: undefined,
    connectedAt: undefined,
    layoutMode: 1,
    busy: false,
    locationLabel: 'F:/repo',
    appearance: {
      fontSize: 14,
      onFontSizeChange: vi.fn(),
      footerActions: ['fontSize', 'stop', 'clear', 'copy', 'save'],
      onToolbarActionsChange: vi.fn(),
    },
    onSaveOutput: vi.fn(),
    onReconnect: vi.fn(),
    onDisconnect: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<SessionFooterBar {...props} />) }
}

describe('SessionFooterBar controls', () => {
  it('places terminal state and utility controls at the right side', () => {
    renderFooter()
    // The session is connected, so Stop stays pressable even though the idle probe reads idle —
    // the probe misreads WSL and fast commands (see SessionControlButtons' live-session gate).
    expect(screen.getByRole('button', { name: 'Stop current process' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Clear terminal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy terminal output' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save terminal output to file' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Customize terminal actions' })).toBeInTheDocument()
    expect(screen.getByText('F:/repo')).toBeInTheDocument()
  })

  it('hides the copy output control unless the footer actions opt into it', () => {
    renderFooter({ appearance: { fontSize: 14, onFontSizeChange: vi.fn(), onToolbarActionsChange: vi.fn() } })
    expect(screen.queryByRole('button', { name: 'Copy terminal output' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save terminal output to file' })).toBeInTheDocument()
  })

  it('shows the shell in the footer and keeps the main latency icon', () => {
    renderFooter({ latency: 42, shellLabel: 'PowerShell 7' })
    expect(screen.getByText('// PowerShell 7')).toBeInTheDocument()
    // A healthy link shows full signal bars, not a warning-looking bolt.
    expect(screen.getByTitle('TCP latency to host · good').querySelector('[data-latency-level="good"]')).toBeInTheDocument()
  })

  it('pulses the latency icon while it is measured, and shows only "-" when it is not', () => {
    const { unmount } = renderFooter({ latency: 42 })
    expect(screen.getByTitle('TCP latency to host · good').querySelector('[data-latency-level="good"]')).toHaveClass('motion-safe:animate-pulse')
    unmount()
    renderFooter({ latency: null })
    const idle = screen.getByTitle('TCP latency to host · not measured')
    expect(idle).toHaveTextContent(/^-$/)
    expect(idle.querySelector('svg')).toBeNull()
  })

  it('keeps the main latency icon when no custom art is configured', () => {
    renderFooter({ latency: 420, appearance: { fontSize: 14, darkMode: false, onFontSizeChange: vi.fn() } })
    expect(screen.getByTitle('TCP latency to host · poor').querySelector('[data-latency-level="poor"]')).toBeInTheDocument()
  })

  it('opens the customize dialog from the footer', () => {
    const { props } = renderFooter()
    fireEvent.click(screen.getByRole('button', { name: 'Customize terminal actions' }))
    expect(screen.getByRole('dialog', { name: 'Customize terminal actions' })).toBeInTheDocument()
    expect(props.appearance?.onToolbarActionsChange).not.toHaveBeenCalled()
  })

  it('leaves identity and status to the pane header, and owns the pane\u2019s attachments', () => {
    const { container, unmount } = renderFooter({ status: 'connected', busy: true })
    expect(screen.queryByRole('button', { name: /Attachments/ })).toBeNull()
    act(() => {
      recordPastedImage('s1', { bytes: new Uint8Array([1, 2]), path: 'C:/data/attachments/agent-shot.png' })
    })
    expect(screen.getByRole('button', { name: 'Attachments (1)' })).toBeInTheDocument()
    expect(screen.queryByText('Connected')).toBeNull()
    expect(container.querySelector('[data-agent-badge]')).toBeNull()
    unmount()
  })
})
