/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LaunchConsoleToolbar } from '../LaunchConsoleToolbar'
import type { LaunchRunSummary } from '../../src/types'

function makeMockRun(overrides: Partial<LaunchRunSummary> = {}): LaunchRunSummary {
  return {
    runId: 'run-tb-1',
    configId: '.::Api',
    name: 'Api',
    type: 'node',
    mode: 'run',
    status: 'running',
    rootDir: '/repo',
    workspaceFolder: '/repo',
    relativeFolder: '.',
    cwd: '/repo',
    terminalCommand: 'node api.js',
    startedAt: 100,
    listeningUrls: [],
    ...overrides,
  }
}

describe('LaunchConsoleToolbar', () => {
  it('renders filter, run actions, and triggers callbacks', () => {
    const onFilterChange = vi.fn()
    const onOpenBrowser = vi.fn()
    const onOpenInTerminal = vi.fn()
    const onCopyLogs = vi.fn()
    const onRestart = vi.fn()
    const onStop = vi.fn()
    const onClearOutput = vi.fn()
    const onClose = vi.fn()

    const run = makeMockRun()

    render(
      <LaunchConsoleToolbar
        filterText="filter"
        onFilterChange={onFilterChange}
        activeRun={run}
        isRunning={true}
        activeRunBrowserUrl="http://localhost:3000"
        copiedLogs={false}
        onOpenBrowser={onOpenBrowser}
        onOpenInTerminal={onOpenInTerminal}
        onCopyLogs={onCopyLogs}
        onRestart={onRestart}
        onStop={onStop}
        onClearOutput={onClearOutput}
        onClose={onClose}
      />,
    )

    // Browser button
    fireEvent.click(screen.getByLabelText(/Open http:\/\/localhost:3000 in browser/i))
    expect(onOpenBrowser).toHaveBeenCalledWith('http://localhost:3000')

    // Terminal tab
    fireEvent.click(screen.getByLabelText('Pop out to terminal tab'))
    expect(onOpenInTerminal).toHaveBeenCalled()

    // Copy logs
    fireEvent.click(screen.getByLabelText('Copy displayed output'))
    expect(onCopyLogs).toHaveBeenCalled()

    // Restart
    fireEvent.click(screen.getByLabelText('Restart Api'))
    expect(onRestart).toHaveBeenCalled()

    // Stop
    fireEvent.click(screen.getByLabelText('Stop Api'))
    expect(onStop).toHaveBeenCalled()

    // Clear output
    fireEvent.click(screen.getByLabelText('Clear displayed output'))
    expect(onClearOutput).toHaveBeenCalled()

    // Close
    fireEvent.click(screen.getByLabelText('Close launch console'))
    expect(onClose).toHaveBeenCalled()
  })
})
