import { useCallback, useRef } from 'react'
import type { WorkspaceScript } from '@omniterm/contract'

/** The editor tab id for a script. One editor per path, so this is also the dedupe key. */
export function editorTabId(scriptPath: string): string {
  return `editor#${scriptPath}`
}

interface ScriptRunHost {
  /** True if the file already has an editor tab open. */
  isEditorOpen: (editorId: string) => boolean
  /** True if `tabId` is still an open tab (a run's pane may have been closed since). */
  isTabOpen: (tabId: string) => boolean
  /** Show the run and the editor together. */
  pair: (terminalId: string, editorId: string) => void
  /** A refused launch. */
  onError: (err: unknown) => void
}

/**
 * Tracks which pane is running which workspace script, so a run and the file's editor can be shown
 * together — launching a file that is open, or opening a file that is running.
 *
 * The correlation cannot be done at the call site: the run's pane id is minted by the backend and only
 * reaches the renderer with the `shell-open` event that follows. So a launch records what it is waiting
 * for, and `noteShellOpen` claims the next pane that arrives carrying a command. A plain "new session"
 * has no command, which is what keeps it from being mistaken for a script run.
 */
export function useScriptRuns(host: ScriptRunHost) {
  // The host's callbacks close over current state and change every render; the returned functions must
  // not, because the `shell-open` subscription is bound once.
  const latest = useRef(host)
  latest.current = host

  const runs = useRef<Record<string, string>>({})
  const pending = useRef<{ path: string; editorId: string | null } | null>(null)

  const run = useCallback((workspaceId: string, script: WorkspaceScript) => {
    const editorId = editorTabId(script.path)
    pending.current = {
      path: script.path,
      editorId: latest.current.isEditorOpen(editorId) ? editorId : null,
    }
    void window.omnitermAPI.workspace.run({ workspaceId, script }).catch((err: unknown) => {
      pending.current = null
      latest.current.onError(err)
    })
  }, [])

  /** Claim a freshly opened pane for the script that was just launched, if one is waiting. */
  const noteShellOpen = useCallback((tabId: string, hasCommand: boolean) => {
    const claim = pending.current
    if (!claim || !hasCommand) return
    pending.current = null
    runs.current[claim.path] = tabId
    if (claim.editorId) latest.current.pair(tabId, claim.editorId)
  }, [])

  /** Pair a just-opened editor with this script's run, if it is still running. */
  const pairWithRun = useCallback((scriptPath: string, editorId: string) => {
    const tabId = runs.current[scriptPath]
    if (tabId && latest.current.isTabOpen(tabId)) latest.current.pair(tabId, editorId)
  }, [])

  return { run, noteShellOpen, pairWithRun }
}
