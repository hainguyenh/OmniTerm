/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TextEditorHandle } from '../../editor/diffEditorModel'
import { GitDiffViewer } from '../GitDiffViewer'
import type { GitFileDiff } from '../gitTypes'

const mockInvoke = vi.fn()
const markSaved = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

interface StubEditorProps {
  localContent: string
  serverContent: string
  viewMode: 'diff' | 'full'
  baseLabel?: string
  onDirtyChange: (dirty: boolean) => void
}

vi.mock('../GitInlineDiffEditor', () => ({
  GitInlineDiffEditor: forwardRef<TextEditorHandle, StubEditorProps>(function StubEditor(props, ref) {
    useImperativeHandle(ref, () => ({ getText: () => 'edited text', markSaved }))
    return (
      <div data-testid="inline-editor" data-mode={props.viewMode} data-base={props.baseLabel}>
        <span data-testid="local">{props.localContent}</span>
        <span data-testid="server">{props.serverContent}</span>
        <button type="button" onClick={() => props.onDirtyChange(true)}>make dirty</button>
      </div>
    )
  }),
}))

const DIFF: GitFileDiff = {
  path: 'src/a.ts',
  is_binary: false,
  hunks: [{
    header: '@@',
    old_start: 1,
    old_lines: 2,
    new_start: 1,
    new_lines: 3,
    lines: [
      { line_type: 'context', content: 'a' },
      { line_type: 'addition', content: 'b' },
      { line_type: 'addition', content: 'c' },
      { line_type: 'deletion', content: 'd' },
    ],
  }],
}

type Handler = (args: Record<string, unknown>) => unknown

let handlers: Record<string, Handler> = {}

beforeEach(() => {
  mockInvoke.mockReset()
  markSaved.mockReset()
  handlers = {
    git_diff: () => DIFF,
    git_diff_branch: () => DIFF,
    git_read_file: () => 'local text',
    git_read_file_revision: (args) => `server@${String(args.revision)}`,
    git_write_file: () => undefined,
    git_stage: () => undefined,
    git_unstage: () => undefined,
  }
  mockInvoke.mockImplementation((cmd: string, args: Record<string, unknown>) => {
    try {
      return Promise.resolve(handlers[cmd]?.(args) ?? null)
    } catch (error) {
      return Promise.reject(error)
    }
  })
})

const fail = (message: unknown): Handler => () => {
  throw message
}

describe('GitDiffViewer loading', () => {
  it('compares against the index for unstaged files and counts additions and deletions', async () => {
    render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} onClose={vi.fn()} />)
    expect(screen.getByText('Loading file diff...')).toBeInTheDocument()
    const editor = await screen.findByTestId('inline-editor')
    expect(editor).toHaveAttribute('data-base', 'Index · staged version')
    expect(screen.getByTestId('local')).toHaveTextContent('local text')
    expect(screen.getByTestId('server')).toHaveTextContent('server@:0')
    expect(screen.getByLabelText('2 lines added, 1 lines removed')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Diff for src/a.ts')
  })

  it('compares staged files against HEAD inline without a dialog', async () => {
    render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged inline onClose={vi.fn()} />)
    expect(await screen.findByTestId('inline-editor')).toHaveAttribute('data-base', 'HEAD')
    expect(screen.getByTestId('server')).toHaveTextContent('server@HEAD')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('compares against a target branch with the branch diff command', async () => {
    render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} targetBranch="release" onClose={vi.fn()} />)
    expect(await screen.findByTestId('inline-editor')).toHaveAttribute('data-base', 'release')
    expect(screen.getByTestId('server')).toHaveTextContent('server@release')
    expect(mockInvoke).toHaveBeenCalledWith('git_diff_branch', { cwd: '/repo', filePath: 'src/a.ts', branch: 'release' })
    expect(screen.queryByRole('button', { name: /Stage file/ })).toBeNull()
  })

  it('falls back to HEAD and then empty text when revisions or the file cannot be read', async () => {
    handlers.git_read_file = fail(new Error('missing'))
    handlers.git_read_file_revision = (args) => {
      if (args.revision === 'HEAD') return 'head text'
      throw new Error('not in index')
    }
    const { unmount } = render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} onClose={vi.fn()} />)
    await screen.findByTestId('inline-editor')
    expect(screen.getByTestId('local')).toBeEmptyDOMElement()
    expect(screen.getByTestId('server')).toHaveTextContent('head text')
    unmount()

    handlers.git_read_file_revision = fail(new Error('no revisions'))
    render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} onClose={vi.fn()} />)
    await screen.findByTestId('inline-editor')
    expect(screen.getByTestId('server')).toBeEmptyDOMElement()
  })

  it('shows Error and non-Error diff failures', async () => {
    handlers.git_diff = fail(new Error('diff broke'))
    const { unmount } = render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} onClose={vi.fn()} />)
    expect(await screen.findByText('diff broke')).toBeInTheDocument()
    unmount()
    handlers.git_diff = fail('raw failure')
    render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} onClose={vi.fn()} />)
    expect(await screen.findByText('raw failure')).toBeInTheDocument()
  })

  it('does not render an editor for binary files', async () => {
    handlers.git_diff = () => ({ path: 'img.png', is_binary: true, hunks: [] })
    render(<GitDiffViewer cwd="/repo" filePath="img.png" staged={false} onClose={vi.fn()} />)
    expect(await screen.findByText('Binary file diff not shown')).toBeInTheDocument()
    expect(screen.queryByTestId('inline-editor')).toBeNull()
  })

  it('ignores load results and failures after unmount', async () => {
    let finish: (value: unknown) => void = () => undefined
    handlers.git_diff = () => new Promise((done) => { finish = done })
    render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} onClose={vi.fn()} />).unmount()
    finish(DIFF)
    let reject: (reason: unknown) => void = () => undefined
    handlers.git_diff = () => new Promise((_done, failLoad) => { reject = failLoad })
    render(<GitDiffViewer cwd="/repo" filePath="src/b.ts" staged={false} onClose={vi.fn()} />).unmount()
    reject(new Error('late'))
    await new Promise<void>((done) => { setTimeout(done, 0) })
    expect(screen.queryByTestId('inline-editor')).toBeNull()
    expect(screen.queryByText('late')).toBeNull()
  })
})

describe('GitDiffViewer interactions', () => {
  const files = ['one.ts', { path: 'src/a.ts', staged: true }, 'three.ts']

  it('navigates between files with buttons and Alt or Ctrl arrows', async () => {
    const onSelectFile = vi.fn()
    render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} allFiles={files} onSelectFile={onSelectFile} onClose={vi.fn()} />)
    await screen.findByTestId('inline-editor')
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous file' }))
    expect(onSelectFile).toHaveBeenLastCalledWith('one.ts', false)
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }))
    expect(onSelectFile).toHaveBeenLastCalledWith('three.ts', false)
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true })
    expect(onSelectFile).toHaveBeenCalledTimes(4)
    // Plain arrows and events the editor already handled are left alone.
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    const handled = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, cancelable: true })
    handled.preventDefault()
    window.dispatchEvent(handled)
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(onSelectFile).toHaveBeenCalledTimes(4)
  })

  it('does not navigate past either end or without a selection handler', async () => {
    const onSelectFile = vi.fn()
    const { rerender } = render(<GitDiffViewer cwd="/repo" filePath="one.ts" staged={false} allFiles={files} onSelectFile={onSelectFile} onClose={vi.fn()} />)
    await screen.findByTestId('inline-editor')
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    rerender(<GitDiffViewer cwd="/repo" filePath="three.ts" staged={false} allFiles={files} onSelectFile={onSelectFile} onClose={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true })
    rerender(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} allFiles={files} onClose={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true })
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    rerender(<GitDiffViewer cwd="/repo" filePath="unlisted.ts" staged={false} allFiles={files} onSelectFile={onSelectFile} onClose={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true })
    expect(onSelectFile).not.toHaveBeenCalled()
  })

  it('closes on Escape and backdrop clicks only while there are no unsaved edits', async () => {
    const onClose = vi.fn()
    render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} onClose={onClose} />)
    await screen.findByTestId('inline-editor')
    fireEvent.click(screen.getByTestId('inline-editor'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'make dirty' }))
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('saves edits with Ctrl+S only when dirty and announces the result', async () => {
    const refresh = vi.fn()
    window.addEventListener('omniterm:git-refresh', refresh)
    render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} onClose={vi.fn()} />)
    await screen.findByTestId('inline-editor')
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    expect(mockInvoke).not.toHaveBeenCalledWith('git_write_file', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: 'make dirty' }))
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    expect(await screen.findByText('Saved successfully')).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledWith('git_write_file', { cwd: '/repo', filePath: 'src/a.ts', content: 'edited text' })
    expect(markSaved).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    window.removeEventListener('omniterm:git-refresh', refresh)
  })

  it('reports a failed save', async () => {
    handlers.git_write_file = fail('disk full')
    render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} onClose={vi.fn()} />)
    await screen.findByTestId('inline-editor')
    fireEvent.click(screen.getByRole('button', { name: 'make dirty' }))
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    expect(await screen.findByText('Save failed: disk full')).toBeInTheDocument()
    expect(markSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Save/ })).toBeEnabled()
  })

  it('stages and unstages the file and swaps to the other version', async () => {
    const onSelectFile = vi.fn()
    const { rerender } = render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} onSelectFile={onSelectFile} onClose={vi.fn()} />)
    await screen.findByTestId('inline-editor')
    fireEvent.click(screen.getByRole('button', { name: /Stage file/ }))
    await waitFor(() => expect(onSelectFile).toHaveBeenCalledWith('src/a.ts', true))
    expect(mockInvoke).toHaveBeenCalledWith('git_stage', { cwd: '/repo', paths: ['src/a.ts'] })

    rerender(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged onSelectFile={onSelectFile} onClose={vi.fn()} />)
    await screen.findByTestId('inline-editor')
    fireEvent.click(screen.getByRole('button', { name: /Unstage/ }))
    await waitFor(() => expect(onSelectFile).toHaveBeenCalledWith('src/a.ts', false))
    expect(mockInvoke).toHaveBeenCalledWith('git_unstage', { cwd: '/repo', paths: ['src/a.ts'] })

    fireEvent.click(screen.getByRole('button', { name: 'Working tree' }))
    expect(onSelectFile).toHaveBeenLastCalledWith('src/a.ts', false)
    fireEvent.click(screen.getByRole('button', { name: /Full file/ }))
    expect(screen.getByTestId('inline-editor')).toHaveAttribute('data-mode', 'full')
  })

  it('swallows staging failures and ignores clicks while staging', async () => {
    let finish: (value: unknown) => void = () => undefined
    handlers.git_stage = () => new Promise((done) => { finish = done })
    render(<GitDiffViewer cwd="/repo" filePath="src/a.ts" staged={false} onClose={vi.fn()} />)
    await screen.findByTestId('inline-editor')
    const stage = screen.getByRole('button', { name: /Stage file/ })
    fireEvent.click(stage)
    await waitFor(() => expect(stage).toBeDisabled())
    stage.removeAttribute('disabled')
    fireEvent.click(stage)
    await act(async () => finish(undefined))
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === 'git_stage')).toHaveLength(1)

    handlers.git_stage = fail(new Error('locked'))
    await waitFor(() => expect(stage).toBeEnabled())
    fireEvent.click(stage)
    await waitFor(() => expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === 'git_stage')).toHaveLength(2))
    await waitFor(() => expect(stage).toBeEnabled())
  })
})
