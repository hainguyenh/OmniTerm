/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mockOmnitermAPI } from '../../testUtils'
import ScriptViewer from '../ScriptViewer'

// `viewable` mirrors what the backend scan now reports (safepath::is_viewable_kind): any text file is
// viewable, `editable` stays limited to executable scripts, and a denied kind is neither.
const BAT = { id: 'deploy.bat', name: 'deploy.bat', path: 'folder#1/deploy.bat', kind: 'bat', shell: 'cmd' as const, editable: true, viewable: true }
const TXT = { id: 'notes.txt', name: 'notes.txt', path: 'folder#1/notes.txt', kind: 'txt', editable: false, viewable: true }
const RDP = { id: 'server.rdp', name: 'server.rdp', path: 'folder#1/server.rdp', kind: 'rdp', editable: false, viewable: true }
const PEM = { id: 'id.pem', name: 'id.pem', path: 'folder#1/id.pem', kind: 'pem', editable: false, viewable: false }
const MD = { id: 'readme.md', name: 'readme.md', path: 'folder#1/readme.md', kind: 'md', editable: false, viewable: true }

describe('ScriptViewer', () => {
  beforeEach(() => localStorage.clear())

  it('loads an editable file read-only, then edits and saves', async () => {
    const readScript = vi.fn(async () => 'echo hello')
    const writeScript = vi.fn(async () => {})
    mockOmnitermAPI({ workspace: { readScript, writeScript } })

    render(<ScriptViewer workspaceId="ws#1" script={BAT} onClose={vi.fn()} onRun={vi.fn()} />)

    await waitFor(() => expect(readScript).toHaveBeenCalledWith('ws#1', 'folder#1/deploy.bat'))

    // Enter edit mode: the textarea is seeded with the loaded content.
    fireEvent.click(screen.getByTitle('Edit'))
    const textarea = await screen.findByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('echo hello')

    fireEvent.change(textarea, { target: { value: 'echo world' } })
    fireEvent.click(screen.getByTitle('Save (Ctrl+S)'))
    await waitFor(() => expect(writeScript).toHaveBeenCalledWith('ws#1', 'folder#1/deploy.bat', 'echo world'))
  }, 15_000)

  /**
   * The feature: a plain text file shows its contents. It previously rendered the "content not
   * available" placeholder, because the viewer keyed the whole body off `editable`.
   */
  it('shows a viewable non-script file read-only, with no edit or run affordance', async () => {
    const readScript = vi.fn(async () => 'release checklist')
    mockOmnitermAPI({ workspace: { readScript } })

    render(<ScriptViewer workspaceId="ws#1" script={TXT} onClose={vi.fn()} onRun={vi.fn()} />)

    expect(await screen.findByText('release checklist')).toBeInTheDocument()
    await waitFor(() => expect(readScript).toHaveBeenCalledWith('ws#1', 'folder#1/notes.txt'))
    // Read-only: no pencil, no save.
    expect(screen.queryByTitle('Edit')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Save (Ctrl+S)')).not.toBeInTheDocument()
    // And no Run: the backend refuses to launch a .txt, so offering it would only produce an error.
    expect(screen.queryByTitle('Run')).not.toBeInTheDocument()
  })

  /** `.rdp` is text — showing which host it points at is the point — but it stays launch-only. */
  it('shows an .rdp file’s contents and still offers Launch', async () => {
    const readScript = vi.fn(async () => 'full address:s:server01')
    const onRun = vi.fn()
    mockOmnitermAPI({ workspace: { readScript } })

    render(<ScriptViewer workspaceId="ws#1" script={RDP} onClose={vi.fn()} onRun={onRun} />)

    expect(await screen.findByText(/full address:s:server01/)).toBeInTheDocument()
    expect(screen.queryByTitle('Edit')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Launch'))
    expect(onRun).toHaveBeenCalled()
  })

  it('shows a placeholder for a denied kind and never reads it', async () => {
    const readScript = vi.fn(async () => 'should never be called')
    mockOmnitermAPI({ workspace: { readScript } })

    render(<ScriptViewer workspaceId="ws#1" script={PEM} onClose={vi.fn()} onRun={vi.fn()} />)

    expect(await screen.findByText(/Content not available to view/i)).toBeInTheDocument()
    expect(readScript).not.toHaveBeenCalled()
    expect(screen.queryByTitle('Edit')).not.toBeInTheDocument()
    // Nothing to run either — a `.pem` is not launchable, so there is no button to offer.
    expect(screen.queryByTitle('Run')).not.toBeInTheDocument()
  })

  /**
   * A read can fail only once opened — over the size cap, or binary behind a text extension. The
   * backend's message names the limit and the setting that raises it, so it must reach the user
   * verbatim rather than being replaced by generic placeholder copy.
   */
  it('surfaces the backend’s reason when a viewable file will not load', async () => {
    const message = 'This file is 3.0 MB and the viewer limit is 1.0 MB. Raise "Max file size to open" in Settings to view it.'
    const readScript = vi.fn(async () => { throw new Error(message) })
    mockOmnitermAPI({ workspace: { readScript } })

    render(<ScriptViewer workspaceId="ws#1" script={TXT} onClose={vi.fn()} onRun={vi.fn()} />)

    expect(await screen.findByText(message)).toBeInTheDocument()
    // No edit affordance for a file whose text never arrived.
    expect(screen.queryByTitle('Edit')).not.toBeInTheDocument()
  })

  /** A provider predating `viewable` must keep working: its editable scripts still open. */
  it('treats a legacy record with no viewable flag as viewable when editable', async () => {
    const readScript = vi.fn(async () => 'echo legacy')
    mockOmnitermAPI({ workspace: { readScript } })
    const legacy = { id: 'a.bat', name: 'a.bat', path: 'folder#1/a.bat', kind: 'bat', editable: true }

    const { container } = render(
      <ScriptViewer workspaceId="ws#1" script={legacy} onClose={vi.fn()} onRun={vi.fn()} />,
    )

    // Asserted on textContent, not findByText: `.bat` is syntax-highlighted, so "echo legacy" is split
    // across a keyword span and a text span.
    await waitFor(() => expect(container.querySelector('pre')?.textContent).toBe('echo legacy'))
    expect(screen.getByTitle('Edit')).toBeInTheDocument()
  })

  /** The feature: a Markdown file gets a Preview toggle, rendering formatted output instead of the
   *  raw-text view every other viewable file gets. */
  it('renders a Markdown file as formatted preview, and back to raw on toggle', async () => {
    const readScript = vi.fn(async () => '# Hello\n\nSome *text*.')
    mockOmnitermAPI({ workspace: { readScript } })

    render(<ScriptViewer workspaceId="ws#1" script={MD} onClose={vi.fn()} onRun={vi.fn()} />)
    await waitFor(() => expect(readScript).toHaveBeenCalled())

    // Not editable, so there is no pencil — only the preview toggle.
    expect(screen.queryByTitle('Edit')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Preview'))

    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument()
    expect(screen.getByText('text', { selector: 'em' })).toBeInTheDocument()

    // Toggling back shows the untouched raw source again.
    fireEvent.click(screen.getByTitle('View raw'))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Hello' })).not.toBeInTheDocument())
  })
})
