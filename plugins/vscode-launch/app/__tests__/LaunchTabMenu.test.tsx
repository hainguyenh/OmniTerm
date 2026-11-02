/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LaunchTabMenu } from '../LaunchTabMenu'
import type { LaunchRunSummary } from '../../src/types'

function makeMockRun(overrides: Partial<LaunchRunSummary> = {}): LaunchRunSummary {
  return {
    runId: 'run-test-1',
    configId: '.::Api Server',
    name: 'Api Server',
    type: 'node',
    mode: 'run',
    status: 'running',
    rootDir: '/repo',
    workspaceFolder: '/repo',
    relativeFolder: '.',
    cwd: '/repo',
    terminalCommand: 'node index.js',
    startedAt: 1000,
    listeningUrls: ['http://localhost:3000'],
    ...overrides,
  }
}

describe('LaunchTabMenu', () => {
  it('renders menu items and triggers actions', () => {
    const onStop = vi.fn()
    const onRestart = vi.fn()
    const onOpenInTerminal = vi.fn()
    const onOpenBrowser = vi.fn()
    const onOpenEditor = vi.fn()
    const onCopyAttachJson = vi.fn()
    const onCopyLogs = vi.fn()
    const onClearLogs = vi.fn()
    const onCloseConsole = vi.fn()
    const onClose = vi.fn()

    const run = makeMockRun()

    render(
      <LaunchTabMenu
        x={100}
        y={200}
        run={run}
        preferredEditor="code"
        browserUrl="http://localhost:3000"
        hasAttach={true}
        onStop={onStop}
        onRestart={onRestart}
        onOpenInTerminal={onOpenInTerminal}
        onOpenBrowser={onOpenBrowser}
        onOpenEditor={onOpenEditor}
        onCopyAttachJson={onCopyAttachJson}
        onCopyLogs={onCopyLogs}
        onClearLogs={onClearLogs}
        onCloseConsole={onCloseConsole}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('menu')).toBeInTheDocument()

    // Stop run
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop Run' }))
    expect(onStop).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()

    // Restart run
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restart Run' }))
    expect(onRestart).toHaveBeenCalled()

    // Pop out terminal
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pop out to Terminal Tab' }))
    expect(onOpenInTerminal).toHaveBeenCalled()

    // Open browser
    fireEvent.click(screen.getByRole('menuitem', { name: /Open http:\/\/localhost:3000 in browser/i }))
    expect(onOpenBrowser).toHaveBeenCalledWith('http://localhost:3000')

    // Open editor
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open folder in VS Code' }))
    expect(onOpenEditor).toHaveBeenCalled()

    // Copy attach JSON
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy attach JSON' }))
    expect(onCopyAttachJson).toHaveBeenCalled()

    // Copy logs
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Logs' }))
    expect(onCopyLogs).toHaveBeenCalled()

    // Clear logs
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear Output' }))
    expect(onClearLogs).toHaveBeenCalled()

    // Close console (running shows Stop & Close Console)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop & Close Console' }))
    expect(onCloseConsole).toHaveBeenCalled()
  })

  it('disables stop for exited runs and closes on Escape or outside click', () => {
    const onClose = vi.fn()
    const onStop = vi.fn()
    const onCloseConsole = vi.fn()
    const exitedRun = makeMockRun({ status: 'exited', exitCode: 0 })

    const { unmount } = render(
      <LaunchTabMenu
        x={50}
        y={50}
        run={exitedRun}
        onStop={onStop}
        onRestart={vi.fn()}
        onOpenInTerminal={vi.fn()}
        onCopyLogs={vi.fn()}
        onClearLogs={vi.fn()}
        onCloseConsole={onCloseConsole}
        onClose={onClose}
      />,
    )

    const stopButton = screen.getByRole('menuitem', { name: 'Stop Run (exited)' })
    expect(stopButton).toBeDisabled()
    fireEvent.click(stopButton)
    expect(onStop).not.toHaveBeenCalled()

    // Exited shows Close Console
    const closeBtn = screen.getByRole('menuitem', { name: 'Close Console' })
    expect(closeBtn).toBeInTheDocument()

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    // Outside mousedown
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)

    unmount()
  })
})
