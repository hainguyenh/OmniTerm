/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LaunchTabsStrip } from '../LaunchTabsStrip'
import type { LaunchRunSummary } from '../../src/types'

function makeRun(id: string, name: string): LaunchRunSummary {
  return {
    runId: id,
    configId: `.::${name}`,
    name,
    type: 'node',
    mode: 'run',
    status: 'running',
    rootDir: '/repo',
    workspaceFolder: '/repo',
    relativeFolder: '.',
    cwd: '/repo',
    terminalCommand: 'node index.js',
    startedAt: 1000,
    listeningUrls: [],
  }
}

describe('LaunchTabsStrip', () => {
  it('renders runs and triggers select and context menu', () => {
    const onSelect = vi.fn()
    const onContextMenu = vi.fn()
    const runs = [makeRun('r-1', 'Server'), makeRun('r-2', 'Worker')]

    render(
      <LaunchTabsStrip
        runs={runs}
        activeRunId="r-1"
        onSelectRun={onSelect}
        onContextMenuRun={onContextMenu}
      />,
    )

    const tab1 = screen.getByRole('tab', { name: /Server/i })
    expect(tab1).toHaveAttribute('aria-selected', 'true')

    const tab2 = screen.getByRole('tab', { name: /Worker/i })
    expect(tab2).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(tab2)
    expect(onSelect).toHaveBeenCalledWith('r-2')

    fireEvent.contextMenu(tab1, { clientX: 100, clientY: 50 })
    expect(onContextMenu).toHaveBeenCalledWith(expect.anything(), runs[0])
  })

  it('renders empty message when no runs exist', () => {
    render(
      <LaunchTabsStrip
        runs={[]}
        activeRunId={null}
        onSelectRun={vi.fn()}
        onContextMenuRun={vi.fn()}
      />,
    )
    expect(screen.getByText('No launch runs yet')).toBeInTheDocument()
  })

  it('handles wheel scroll on tablist', () => {
    const runs = [makeRun('r-1', 'Server')]
    render(
      <LaunchTabsStrip
        runs={runs}
        activeRunId="r-1"
        onSelectRun={vi.fn()}
        onContextMenuRun={vi.fn()}
      />,
    )
    const tablist = screen.getByRole('tablist')
    fireEvent.wheel(tablist, { deltaY: 50 })
    expect(tablist).toBeInTheDocument()
  })

  it('triggers onCloseRun with "Stop & Close Console" when running and "Close Console" when exited', () => {
    const onClose = vi.fn()
    const runs = [
      makeRun('r-1', 'Server'),
      { ...makeRun('r-2', 'Worker'), status: 'exited' as const },
    ]
    render(
      <LaunchTabsStrip
        runs={runs}
        activeRunId="r-1"
        onSelectRun={vi.fn()}
        onCloseRun={onClose}
        onContextMenuRun={vi.fn()}
      />,
    )
    const runningCloseBtn = screen.getByRole('button', { name: 'Stop & Close Console' })
    fireEvent.click(runningCloseBtn)
    expect(onClose).toHaveBeenCalledWith('r-1')

    const exitedCloseBtn = screen.getByRole('button', { name: 'Close Console' })
    fireEvent.click(exitedCloseBtn)
    expect(onClose).toHaveBeenCalledWith('r-2')
  })
})
