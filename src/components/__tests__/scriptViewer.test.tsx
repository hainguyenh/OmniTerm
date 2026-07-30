/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mockOmnitermAPI } from '../../testUtils'
import ScriptViewer from '../ScriptViewer'

const BAT = { id: 'deploy.bat', name: 'deploy.bat', path: 'C:/proj/deploy.bat', kind: 'bat', shell: 'cmd' as const, editable: true }
const RDP = { id: 'server.rdp', name: 'server.rdp', path: 'C:/proj/server.rdp', kind: 'rdp', editable: false }

describe('ScriptViewer', () => {
  beforeEach(() => localStorage.clear())

  it('loads an editable file read-only, then edits and saves', async () => {
    const readScript = vi.fn(async () => 'echo hello')
    const writeScript = vi.fn(async () => {})
    mockOmnitermAPI({ workspace: { readScript, writeScript } })

    render(<ScriptViewer workspaceId="ws#1" script={BAT} onClose={vi.fn()} onRun={vi.fn()} />)

    await waitFor(() => expect(readScript).toHaveBeenCalledWith('ws#1', 'C:/proj/deploy.bat'))

    // Enter edit mode: the textarea is seeded with the loaded content.
    fireEvent.click(screen.getByTitle('Edit'))
    const textarea = await screen.findByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('echo hello')

    fireEvent.change(textarea, { target: { value: 'echo world' } })
    fireEvent.click(screen.getByTitle('Save (Ctrl+S)'))
    await waitFor(() => expect(writeScript).toHaveBeenCalledWith('ws#1', 'C:/proj/deploy.bat', 'echo world'))
  })

  it('shows a "content not available" placeholder for .rdp and never reads it', async () => {
    const readScript = vi.fn(async () => '')
    const onRun = vi.fn()
    mockOmnitermAPI({ workspace: { readScript } })

    render(<ScriptViewer workspaceId="ws#1" script={RDP} onClose={vi.fn()} onRun={onRun} />)

    expect(await screen.findByText(/Content not available to view/i)).toBeInTheDocument()
    expect(readScript).not.toHaveBeenCalled()
    // No edit affordance for non-editable items.
    expect(screen.queryByTitle('Edit')).not.toBeInTheDocument()

    // Launch action triggers onRun.
    fireEvent.click(screen.getByTitle('Launch'))
    expect(onRun).toHaveBeenCalled()
  })
})
