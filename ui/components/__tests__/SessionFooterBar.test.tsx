/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { mockOmnitermAPI } from '../../testUtils'
import { releasePastedImage, setLastPastedImage, subscribeOpen } from '../../utils/pastedImageStore'
import { SessionFooterBar } from '../SessionFooterBar'

const local: Connection = {
  id: 'local', name: 'Local', type: 'LOCAL', host: '', port: '', user: '', localCwd: 'F:/repo',
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  releasePastedImage('s1')
  releasePastedImage('s2')
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

  it('shows the shell in the footer and keeps the main latency icon', () => {
    renderFooter({ latency: 42, shellLabel: 'PowerShell 7', loadingArtUrl: 'blob:loading-gif' })
    expect(screen.getByText('// PowerShell 7')).toBeInTheDocument()
    expect(screen.getByTitle('TCP latency to host').querySelector('svg')).toBeInTheDocument()
  })

  it('keeps the main latency icon when no custom art is configured', () => {
    renderFooter({ latency: 42, appearance: { fontSize: 14, darkMode: false, onFontSizeChange: vi.fn() } })
    expect(screen.getByTitle('TCP latency to host').querySelector('svg')).toBeInTheDocument()
  })

  it('opens the customize dialog from the footer', () => {
    const { props } = renderFooter()
    fireEvent.click(screen.getByRole('button', { name: 'Customize terminal actions' }))
    expect(screen.getByRole('dialog', { name: 'Customize terminal actions' })).toBeInTheDocument()
    expect(props.appearance?.onToolbarActionsChange).not.toHaveBeenCalled()
  })

  it('shows the pasted image review button when images exist and triggers viewer on click', () => {
    const { unmount } = renderFooter()
    expect(screen.queryByRole('button', { name: 'View last pasted image' })).toBeNull()

    act(() => {
      setLastPastedImage('s1', { bytes: new Uint8Array([1, 2]), path: 'C:/temp/agent-shot.png' })
    })

    const button = screen.getByRole('button', { name: 'View last pasted image' })
    expect(button).toBeInTheDocument()

    const onOpen = vi.fn()
    const unsubscribe = subscribeOpen('s1', onOpen)
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
    unsubscribe()

    act(() => {
      releasePastedImage('s1')
    })
    expect(screen.queryByRole('button', { name: 'View last pasted image' })).toBeNull()
    unmount()
  })

  it('does not display image button for a different session', () => {
    act(() => {
      setLastPastedImage('s2', { bytes: new Uint8Array([1]), path: 'C:/temp/other.png' })
    })
    const { unmount } = renderFooter({ sessionId: 's1' })
    expect(screen.queryByRole('button', { name: 'View last pasted image' })).toBeNull()
    unmount()
  })
})
