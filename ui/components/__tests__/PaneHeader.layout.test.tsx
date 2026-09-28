/** @vitest-environment jsdom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import PaneHeader from '../PaneHeader'

vi.mock('../SessionControlButtons', () => ({
  default: () => <div data-testid="session-controls" />,
}))
vi.mock('../SessionStatusIndicator', () => ({
  default: () => <span data-testid="session-status" />,
}))
vi.mock('../Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const connection: Connection = {
  id: 'local-1',
  name: 'OmniTerm',
  type: 'LOCAL',
  host: '',
  port: '',
  user: '',
}

describe('PaneHeader layout', () => {
  it('leaves the shell label for the footer and sizes the control slot to its buttons', () => {
    render(
      <PaneHeader
        paneIndex={0}
        conn={connection}
        sessionTitle="OmniTerm"
        shellLabel="PowerShell 7"
        focused
        sessionId="session-1"
        tabs={[]}
        panes={['session-1']}
        layoutMode={1}
        statuses={{ 'session-1': 'connected' }}
        connType={() => 'LOCAL'}
        pickerOpen={false}
        pickerRef={React.createRef<HTMLDivElement>()}
        detach={null}
        onToggleDetach={vi.fn()}
        onFocus={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onTogglePicker={vi.fn()}
        onAssign={vi.fn()}
        onClear={vi.fn()}
      />,
    )

    expect(screen.getByText('OmniTerm')).toHaveClass('shrink')
    expect(screen.queryByText('// PowerShell 7')).toBeNull()
    // The title (and its activity zone) grows into everything the controls do not need, up to the
    // theme button, instead of stopping at the header's centre.
    const controls = screen.getByTestId('pane-header-controls')
    expect(controls).toHaveClass('flex-initial', 'max-w-[50%]', 'min-w-[3.5rem]')
    expect(controls).not.toHaveClass('flex-1')
    expect(screen.getByTestId('pane-header-title')).toHaveClass('flex-1')
  })
})
