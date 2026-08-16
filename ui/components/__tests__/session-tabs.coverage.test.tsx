/**
 * @vitest-environment jsdom
 */
import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SessionTabs, { type SessionTabItem } from '../SessionTabs'

const connectionTypes: Record<string, 'LOCAL' | 'RDP' | 'SSH'> = {
  'local-c': 'LOCAL',
  'rdp-c': 'RDP',
  'ssh-c': 'SSH',
  'closed-c': 'SSH',
}

const tabs: SessionTabItem[] = [
  { id: 'editor-1', connId: 'file-1', name: 'deploy.sh' },
  { id: 'local-1', connId: 'local-c', name: 'PowerShell' },
  { id: 'rdp-1', connId: 'rdp-c', name: 'Desktop' },
  { id: 'ssh-1', connId: 'ssh-c', name: 'Production' },
  { id: 'closed-1', connId: 'closed-c', name: 'Closed' },
]

function renderTabs(overrides: Partial<ComponentProps<typeof SessionTabs>> = {}) {
  const props: ComponentProps<typeof SessionTabs> = {
    tabs,
    panes: ['editor-1', 'local-1', null],
    layoutMode: 3,
    focusedPane: 0,
    statuses: {
      'local-1': 'connected',
      'rdp-1': 'connecting',
      'ssh-1': 'error',
      'closed-1': 'closed',
    },
    activity: { 'local-1': true },
    isEditor: (id) => id.startsWith('editor'),
    isPreview: (id) => id === 'editor-1',
    isEphemeral: (id) => id === 'local-c',
    connType: (id) => connectionTypes[id],
    onSelect: vi.fn(),
    onPromote: vi.fn(),
    onClose: vi.fn(),
    onContextMenu: vi.fn(),
    onNewSession: vi.fn(),
    onPickShell: vi.fn(),
    onReveal: vi.fn(),
    ...overrides,
  }
  return { ...render(<SessionTabs {...props} />), props }
}

describe('SessionTabs', () => {
  it('renders focused/background session states and pane badges', () => {
    const { container } = renderTabs()
    expect(screen.getByText('deploy.sh')).toHaveClass('italic')
    expect(screen.getByText('PowerShell')).toBeInTheDocument()
    expect(screen.getByText('Desktop')).toBeInTheDocument()
    expect(screen.getByText('Production')).toHaveClass('text-theme-error')
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByLabelText('Reveal in workspace tree')).toBeInTheDocument()
    expect(container.querySelector('.animate-ping')).toBeInTheDocument()
  })

  it('formats AI agent tabs as {AI agent} - {folder} // {shell}', () => {
    renderTabs({
      tabs: [{ id: 'agent-1', connId: 'local-c', name: 'claude: ~/my-project' }],
      getShellLabel: () => 'PowerShell 7',
    })
    expect(screen.getByText('Claude Code - my-project // PowerShell 7')).toBeInTheDocument()
  })

  it('selects, promotes, closes, and opens context actions', () => {
    const { props } = renderTabs()
    const tab = screen.getByText('Production').closest('div.group') as HTMLElement
    fireEvent.click(tab)
    fireEvent.doubleClick(tab)
    fireEvent.contextMenu(tab)
    fireEvent.mouseDown(tab, { button: 1 })
    fireEvent(tab, new MouseEvent('auxclick', { button: 1, bubbles: true }))

    expect(props.onSelect).toHaveBeenCalledWith('ssh-1')
    expect(props.onPromote).toHaveBeenCalledWith('ssh-1')
    expect(props.onContextMenu).toHaveBeenCalledWith(expect.anything(), 'ssh-1')
    expect(props.onClose).toHaveBeenCalledWith('ssh-1')
  })

  it('reveals an editor without selecting it and closes from its button', () => {
    const { props } = renderTabs()
    fireEvent.click(screen.getByLabelText('Reveal in workspace tree'))
    expect(props.onReveal).toHaveBeenCalledWith('editor-1')
    expect(props.onSelect).not.toHaveBeenCalled()

    const editor = screen.getByText('deploy.sh').closest('div.group') as HTMLElement
    const close = editor.querySelector('button[aria-label="Close tab"]') as HTMLButtonElement
    fireEvent.click(close)
    expect(props.onClose).toHaveBeenCalledWith('editor-1')
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('starts a default terminal or opens the shell picker', () => {
    const onNewSession = vi.fn()
    const onPickShell = vi.fn()
    renderTabs({ onNewSession, onPickShell })
    fireEvent.click(screen.getByLabelText('New Terminal'))
    fireEvent.click(screen.getByLabelText('Select Shell'))
    expect(onNewSession).toHaveBeenCalledOnce()
    expect(onPickShell).toHaveBeenCalledWith(expect.objectContaining({ width: expect.any(Number) }))
  })

  it('opens focused-dock session picker when requested', () => {
    const onPickPane = vi.fn()
    renderTabs({ onPickPane })
    fireEvent.click(screen.getByRole('button', { name: 'Choose tab for focused dock' }))
    expect(onPickPane).toHaveBeenCalledWith(expect.objectContaining({ width: expect.any(Number) }))
  })

  it('hides pane badges and reveal controls when tabs are not focused', () => {
    renderTabs({ panes: [null], layoutMode: 1, focusedPane: 0 })
    expect(screen.queryByLabelText('Reveal in workspace tree')).not.toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  // The tab label is a plain passthrough of the session title. Vietnamese (and other non-ASCII)
  // names must reach the DOM byte-for-byte; any mangling here would be an app-layer encoding bug
  // rather than the byte-decode mojibake that happens upstream in the PTY stream.
  it('renders Vietnamese and other Unicode tab names without mangling them', () => {
    const name = 'Dự án · 部署 · プロジェクト · 中文'
    renderTabs({ tabs: [{ id: 'vi-1', connId: 'local-c', name }] })
    const label = screen.getByText(name)
    expect(label.textContent).toBe(name)
    expect(label.closest('div.group')).toBeInTheDocument()
  })

  it('renders animated marching-ants dashed border for running sessions and omits left rail stripe', () => {
    const { container } = renderTabs({
      activity: { 'local-1': true },
      statuses: { 'local-1': 'connected' },
    })
    expect(container.querySelector('.animate-marching-ants')).toBeInTheDocument()
    expect(container.querySelector('.w-\\[3px\\]')).not.toBeInTheDocument()
  })
})
