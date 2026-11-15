import { useEffect } from 'react'

import { clearContext, setContext } from '../ide/platform/context'
import { resolveShortcuts } from '../utils/shortcuts'
import { installOmniTermActions } from './omnitermActions'
import { openGitToolWindow } from './openGitToolWindow'
import { useProjectBridge } from './projectBridge'

/** Context keys OmniTerm publishes for `when` clauses of workbench actions. */
export const SHELL_CONTEXT_KEYS = ['terminalFocus', 'editorFocus', 'sessionCount'] as const

interface WorkbenchBridgeInput {
  shortcuts: ShortcutBindings | undefined
  /** What the focused pane holds, or null when no pane has a session. */
  focusedKind: 'terminal' | 'editor' | null
  sessionCount: number
  /** The selected OmniTerm workspace, which becomes the workbench project. */
  workspaceId?: string | null
  /** The selected workspace's folder paths, joined; a change reopens the project. */
  workspaceFolders?: string
}

/**
 * Connects the main window to the workbench platform layer: OmniTerm's commands become actions with
 * their configured shortcuts, and the focused pane and session count become context keys.
 */
export function useWorkbenchBridge({ shortcuts, focusedKind, sessionCount, workspaceId = null, workspaceFolders = '' }: WorkbenchBridgeInput): void {
  useProjectBridge(workspaceId, workspaceFolders)
  useEffect(() => installOmniTermActions(resolveShortcuts(shortcuts)), [shortcuts])

  // The activity bar and the session footer ask for the Git window with this event.
  useEffect(() => {
    window.addEventListener('omniterm:open-git', openGitToolWindow)
    return () => window.removeEventListener('omniterm:open-git', openGitToolWindow)
  }, [])

  useEffect(() => {
    setContext('terminalFocus', focusedKind === 'terminal')
    setContext('editorFocus', focusedKind === 'editor')
    setContext('sessionCount', sessionCount)
  }, [focusedKind, sessionCount])

  useEffect(() => () => {
    for (const key of SHELL_CONTEXT_KEYS) clearContext(key)
  }, [])
}
