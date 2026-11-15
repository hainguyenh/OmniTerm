/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeActionMock } = vi.hoisted(() => ({
  executeActionMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../ide/platform/actions', () => ({
  executeAction: executeActionMock,
  registerAction: vi.fn(() => () => {}),
}))

import { LspStatusWidget } from '../lsp/LspStatusWidget'
import { useLspServersStore } from '../lsp/lspServersStore'

describe('LspStatusWidget & lspServersStore', () => {
  beforeEach(() => {
    executeActionMock.mockClear()
    act(() => {
      useLspServersStore.getState().reset()
    })
  })

  it('renders default Idle status badge when no servers running', () => {
    render(<LspStatusWidget />)
    const badge = screen.getByTestId('lsp-status-badge')
    expect(badge).toBeTruthy()
    expect(badge.textContent).toBe('LSP')
    expect(screen.queryByTestId('lsp-status-popover')).toBeNull()
  })

  it('renders Ready status badge when language server is ready', () => {
    act(() => {
      useLspServersStore.getState().setServer({
        id: 1,
        name: 'rust-analyzer',
        languages: ['rust'],
        status: 'Ready',
        rawStatus: 'ready',
        message: null,
        installHint: null,
      })
    })

    render(<LspStatusWidget />)
    const badge = screen.getByTestId('lsp-status-badge')
    expect(badge.textContent).toContain('rust-analyzer: Ready')
  })

  it('renders Starting spinner status when server is initializing', () => {
    act(() => {
      useLspServersStore.getState().setServer({
        id: 2,
        name: 'vtsls',
        languages: ['typescript'],
        status: 'Starting',
        rawStatus: 'starting',
        message: null,
        installHint: null,
      })
    })

    render(<LspStatusWidget />)
    const badge = screen.getByTestId('lsp-status-badge')
    expect(badge.textContent).toContain('vtsls: Starting')
  })

  it('renders Missing warning when language server binary is missing', () => {
    act(() => {
      useLspServersStore.getState().setServer({
        id: 3,
        name: 'rust-analyzer',
        languages: ['rust'],
        status: 'Missing',
        rawStatus: 'missing',
        message: 'rust-analyzer binary not found',
        installHint: 'rustup component add rust-analyzer',
      })
    })

    render(<LspStatusWidget />)
    const badge = screen.getByTestId('lsp-status-badge')
    expect(badge.textContent).toContain('rust-analyzer: Missing')
  })

  it('opens popover on click and shows server details, guidance, and restart button', () => {
    act(() => {
      useLspServersStore.getState().setServer({
        id: 42,
        name: 'rust-analyzer',
        languages: ['rust'],
        status: 'Missing',
        rawStatus: 'missing',
        message: 'Binary not found',
        installHint: 'rustup component add rust-analyzer',
      })
    })

    render(<LspStatusWidget />)

    // Open popover
    fireEvent.click(screen.getByTestId('lsp-status-badge'))
    expect(screen.getByTestId('lsp-status-popover')).toBeTruthy()

    // Guidance and install command displayed
    expect(screen.getByTestId('lsp-install-guidance')).toBeTruthy()
    expect(screen.getByText('rustup component add rust-analyzer')).toBeTruthy()

    // Clicking restart invokes lsp.restart action
    const restartBtn = screen.getByTestId('lsp-restart-button')
    fireEvent.click(restartBtn)
    expect(executeActionMock).toHaveBeenCalledWith('lsp.restart', 42)

    // Clicking Restart All
    const restartAllBtn = screen.getByTestId('lsp-restart-all-button')
    fireEvent.click(restartAllBtn)
    expect(executeActionMock).toHaveBeenCalledWith('lsp.restart')
  })

  it('closes popover when clicking outside', () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <LspStatusWidget />
      </div>,
    )

    // Open popover
    fireEvent.click(screen.getByTestId('lsp-status-badge'))
    expect(screen.getByTestId('lsp-status-popover')).toBeTruthy()

    // Click outside
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByTestId('lsp-status-popover')).toBeNull()
  })
})
