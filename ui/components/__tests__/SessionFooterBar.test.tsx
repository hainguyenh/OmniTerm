/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { mockOmnitermAPI } from '../../testUtils'
import { SessionFooterBar } from '../SessionFooterBar'

const local: Connection = {
  id: 'local', name: 'Local', type: 'LOCAL', host: '', port: '', user: '', localCwd: 'F:/repo',
}

beforeEach(() => {
  localStorage.clear()
  mockOmnitermAPI({
    connect: {
      localInput: vi.fn(),
      setPersistencePolicy: vi.fn().mockResolvedValue(undefined),
    },
  })
})

const renderFooter = (overrides: Partial<React.ComponentProps<typeof SessionFooterBar>> = {}) => {
  const props: React.ComponentProps<typeof SessionFooterBar> = {
    conn: local,
    sessionId: 's1',
    tabName: 'Antigravity CLI - repo',
    status: 'connected',
    latency: null,
    metrics: undefined,
    connectedAt: undefined,
    layoutMode: 1,
    focusedPane: 0,
    busy: false,
    workspaceTitle: 'Dev - repo',
    footerShellLabel: 'PowerShell 7',
    zoomFactor: 1,
    detach: 'detach',
    onToggleDetach: vi.fn(),
    fullscreen: false,
    onToggleFullscreen: vi.fn(),
    onReconnect: vi.fn(),
    onDisconnect: vi.fn(),
    onZoomReset: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<SessionFooterBar {...props} />) }
}

describe('SessionFooterBar controls', () => {
  it('places the five terminal controls at the right side for the active agent session', () => {
    renderFooter()
    expect(screen.getByRole('button', { name: 'Stop current process' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear terminal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Session persistence' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Detach into its own window' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus pane full screen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus pane full screen' }).parentElement?.className).toContain('ml-auto')
  })

  it('invokes detach and fullscreen from the footer', () => {
    const { props } = renderFooter()
    fireEvent.click(screen.getByRole('button', { name: 'Detach into its own window' }))
    fireEvent.click(screen.getByRole('button', { name: 'Focus pane full screen' }))
    expect(props.onToggleDetach).toHaveBeenCalledOnce()
    expect(props.onToggleFullscreen).toHaveBeenCalledOnce()
  })
})
