/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockOmnitermAPI } from '../../testUtils'
import ScriptViewer from '../ScriptViewer'

vi.mock('../MarkdownPreview', () => ({
  default: ({ content, onFallback }: { content: string; onFallback: () => void }) => (
    <div data-testid="markdown-preview">{content}<button onClick={onFallback}>fail-preview</button></div>
  ),
}))

const script = {
  id: 'deploy.sh', name: 'deploy.sh', path: '/workspace/deploy.sh', kind: 'sh', shell: 'wsl' as const,
  editable: true, viewable: true,
}
const markdown = {
  id: 'README.md', name: 'README.md', path: '/workspace/README.md', kind: 'md', editable: false, viewable: true,
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  })
})
afterEach(() => vi.restoreAllMocks())

describe('ScriptViewer remaining behavior', () => {
  it('reports dirty state, saves from the keyboard, surfaces save errors, and can retry', async () => {
    const writeScript = vi.fn()
      .mockRejectedValueOnce(new Error('disk read only'))
      .mockResolvedValueOnce(undefined)
    mockOmnitermAPI({ workspace: { readScript: vi.fn(async () => 'echo old'), writeScript } })
    const onDirtyChange = vi.fn()
    render(<ScriptViewer workspaceId="ws" script={script} onClose={vi.fn()} onRun={vi.fn()} onDirtyChange={onDirtyChange} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'echo new' } })
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))

    fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    expect(await screen.findByText('disk read only')).toBeInTheDocument()
    expect(writeScript).toHaveBeenCalledWith('ws', script.path, 'echo new')

    fireEvent.click(screen.getByRole('button', { name: 'Save (Ctrl+S)' }))
    await waitFor(() => expect(writeScript).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
    expect(screen.queryByText('disk read only')).not.toBeInTheDocument()
  })

  it('confirms a dirty close, keeps editing, discards, runs, copies the path, and syncs scroll', async () => {
    mockOmnitermAPI({ workspace: { readScript: vi.fn(async () => 'echo old') } })
    const onClose = vi.fn()
    const onRun = vi.fn()
    const view = render(<ScriptViewer workspaceId="ws" script={script} onClose={onClose} onRun={onRun} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Run' }))
    expect(onRun).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(script.path))
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'changed' } })
    const pre = view.container.querySelector('pre') as HTMLPreElement
    Object.defineProperty(textarea, 'scrollTop', { configurable: true, value: 27 })
    Object.defineProperty(textarea, 'scrollLeft', { configurable: true, value: 9 })
    fireEvent.scroll(textarea)
    expect(pre.scrollTop).toBe(27)
    expect(pre.scrollLeft).toBe(9)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Keep editing'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByText('Discard'))
    expect(onClose).toHaveBeenCalled()
  })

  it('falls back from a failed preview and closes clean files immediately', async () => {
    mockOmnitermAPI({ workspace: { readScript: vi.fn(async () => '# Heading') } })
    const onClose = vi.fn()
    render(<ScriptViewer workspaceId="ws" script={markdown} onClose={onClose} onRun={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Heading')
    fireEvent.click(screen.getByText('fail-preview'))
    expect(screen.getByText(/Preview took too long/)).toBeInTheDocument()
    expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not save unchanged content or save while already saving', async () => {
    const pending = new Promise<void>(() => {})
    const writeScript = vi.fn(() => pending)
    mockOmnitermAPI({ workspace: { readScript: vi.fn(async () => 'same'), writeScript } })
    render(<ScriptViewer workspaceId="ws" script={script} onClose={vi.fn()} onRun={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Save (Ctrl+S)' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    expect(writeScript).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save (Ctrl+S)' }))
    fireEvent.keyDown(document, { key: 's', metaKey: true })
    await act(async () => {})
    expect(writeScript).toHaveBeenCalledTimes(1)
  })
})
