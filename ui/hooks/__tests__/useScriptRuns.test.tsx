/**
 * @vitest-environment jsdom
 *
 * Pairing a script's run with its editor.
 *
 * The rule is deliberately narrow: the layout is only rearranged when both halves already exist for the
 * same file — launching a file that is open, or opening a file that is running. Anything else leaves the
 * user's layout alone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { WorkspaceScript } from '@omniterm/contract'
import { useScriptRuns, editorTabId } from '../useScriptRuns'

const script: WorkspaceScript = {
  id: 'deploy.bat',
  name: 'deploy.bat',
  path: 'D:\\ws\\deploy.bat',
  kind: 'bat',
  editable: true,
}

function setup(over: { openEditors?: string[]; openTabs?: string[] } = {}) {
  const pair = vi.fn()
  const onError = vi.fn()
  const run = vi.fn().mockResolvedValue(true)
  ;(window as any).omnitermAPI = { workspace: { run } }

  const { result } = renderHook(() => useScriptRuns({
    isEditorOpen: (id) => (over.openEditors ?? []).includes(id),
    isTabOpen: (id) => (over.openTabs ?? []).includes(id),
    pair,
    onError,
  }))
  return { hook: result, pair, onError, run }
}

beforeEach(() => {
  delete (window as any).omnitermAPI
})

describe('useScriptRuns', () => {
  it('runs the script through the host bridge', () => {
    const { hook, run } = setup()
    hook.current.run('ws#1', script)
    expect(run).toHaveBeenCalledWith({ workspaceId: 'ws#1', script })
  })

  /** Launching a file whose editor is open: the run's pane pairs with that editor. */
  it('pairs the new pane with the editor that was already open', () => {
    const editorId = editorTabId(script.path)
    const { hook, pair } = setup({ openEditors: [editorId] })

    hook.current.run('ws#1', script)
    hook.current.noteShellOpen('adhoc-1', true)

    expect(pair).toHaveBeenCalledWith('adhoc-1', editorId)
  })

  it('leaves the layout alone when the file is not open', () => {
    const { hook, pair } = setup()
    hook.current.run('ws#1', script)
    hook.current.noteShellOpen('adhoc-1', true)
    expect(pair).not.toHaveBeenCalled()
  })

  /**
   * A pane with no command is a plain "new session" — pressing Ctrl+N while a launch is in flight must
   * not hand that pane to the script.
   */
  it('never claims a pane that is not running a command', () => {
    const editorId = editorTabId(script.path)
    const { hook, pair } = setup({ openEditors: [editorId], openTabs: ['adhoc-2'] })

    hook.current.run('ws#1', script)
    hook.current.noteShellOpen('adhoc-1', false)
    expect(pair).not.toHaveBeenCalled()

    // The claim is still pending, so the next pane that *is* a run gets it.
    hook.current.noteShellOpen('adhoc-2', true)
    expect(pair).toHaveBeenCalledWith('adhoc-2', editorId)
  })

  /** Viewing a file that is already running: the editor pairs with the run that exists. */
  it('pairs a newly opened editor with the run it started earlier', () => {
    const editorId = editorTabId(script.path)
    const { hook, pair } = setup({ openTabs: ['adhoc-1'] })

    hook.current.run('ws#1', script)      // no editor open yet — no pairing
    hook.current.noteShellOpen('adhoc-1', true)
    expect(pair).not.toHaveBeenCalled()

    hook.current.pairWithRun(script.path, editorId)
    expect(pair).toHaveBeenCalledWith('adhoc-1', editorId)
  })

  /** The run's pane may have been closed since; pairing with a dead tab would blank a pane. */
  it('does not pair with a run whose pane has been closed', () => {
    const { hook, pair } = setup({ openTabs: [] })
    hook.current.run('ws#1', script)
    hook.current.noteShellOpen('adhoc-1', true)
    hook.current.pairWithRun(script.path, editorTabId(script.path))
    expect(pair).not.toHaveBeenCalled()
  })

  it('never pairs a file that was never run', () => {
    const { hook, pair } = setup({ openTabs: ['adhoc-1'] })
    hook.current.pairWithRun('D:\\ws\\other.bat', editorTabId('D:\\ws\\other.bat'))
    expect(pair).not.toHaveBeenCalled()
  })

  /** A refused launch must surface, and must not leave a claim that hijacks the next pane opened. */
  it('reports a refused launch and drops the pending claim', async () => {
    const editorId = editorTabId(script.path)
    const { hook, pair, onError } = setup({ openEditors: [editorId] })
    ;(window as any).omnitermAPI.workspace.run = vi.fn().mockRejectedValue(new Error('nope'))

    hook.current.run('ws#1', script)
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())

    hook.current.noteShellOpen('adhoc-9', true)
    expect(pair).not.toHaveBeenCalled()
  })
})
