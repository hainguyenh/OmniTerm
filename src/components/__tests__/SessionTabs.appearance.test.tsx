/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SessionTabs from '../SessionTabs'

describe('SessionTabs pane surfaces', () => {
  it('uses matching identity tints for focused and docked tabs', () => {
    render(
      <SessionTabs
        tabs={[
          { id: 'focused', connId: 'ssh-1', name: 'Focused' },
          { id: 'docked', connId: 'ssh-2', name: 'Docked' },
        ]}
        panes={['focused', 'docked']}
        layoutMode={2}
        focusedPane={0}
        statuses={{ focused: 'connected', docked: 'connected' }}
        activity={{}}
        isEditor={() => false}
        isPreview={() => false}
        isEphemeral={() => false}
        connType={() => 'SSH'}
        onSelect={vi.fn()}
        onPromote={vi.fn()}
        onClose={vi.fn()}
        onContextMenu={vi.fn()}
        onNewSession={vi.fn()}
        onPickShell={vi.fn()}
        onReveal={vi.fn()}
      />,
    )

    expect(screen.getByTitle(/Focused/)).toHaveStyle({ backgroundColor: '#7aa2f72e' })
    expect(screen.getByTitle(/Docked/)).toHaveStyle({ backgroundColor: '#e0af681a' })
  })
})
