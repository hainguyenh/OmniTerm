import type { Terminal } from '@xterm/xterm'

import type { Connection } from '../components/MainLayout'
import { imagePasteModeFor } from '../utils/agentRegistry'
import { DEFAULT_ENTER_MODES, enterSequenceFor, type EnterModes } from '../utils/enterKeys'
import { matchShortcut } from '../utils/keyboard'
import { canPasteAsPowerShellScript, clipboardActionFor } from '../utils/paste'
import { FALLBACK_SHORTCUTS, matchesChromeShortcut, resolveShortcuts } from '../utils/shortcuts'
import type { TerminalClipboard } from '../utils/terminalClipboard'

import { onCtrlC } from './ctrlCGuard'
import { ctrlCSettings, syncCtrlCSettings } from './ctrlCSettings'

export interface TerminalKeyHandlerOptions {
  sessionId: string
  term: Terminal
  clipboard: TerminalClipboard
  connection: Connection
  isMac: boolean
  getAgentName: () => string | null
  getShortcuts: () => Partial<ShortcutBindings> | undefined
  getEnterModes: () => EnterModes | undefined
  /**
   * Set once the process has ended after an interrupt and the tab was kept. Enter then restarts the
   * session and Ctrl+C closes it, matching the line printed when the process exited.
   */
  getExitedActions?: () => { restart: () => void } | null
  /** Called when a lone Ctrl+C was sent to the process, so the pane can hint that a second press closes. */
  onInterruptHint?: () => void
}

/**
 * Creates the custom key event handler for an xterm instance.
 * Handles clipboard shortcuts, modifier+enter sequences, and app-level shortcut bubbling.
 */
export const createTerminalKeyHandler = ({
  sessionId,
  term,
  clipboard,
  connection,
  isMac,
  getAgentName,
  getShortcuts,
  getEnterModes,
  getExitedActions,
  onInterruptHint,
}: TerminalKeyHandlerOptions): ((e: KeyboardEvent) => boolean) => {
  syncCtrlCSettings()
  return (e: KeyboardEvent) => {
    if (e.type !== 'keydown') return true

    const shortcuts = getShortcuts()
    const scriptShortcut = shortcuts?.pasteScript ?? FALLBACK_SHORTCUTS.pasteScript
    const isScript = matchShortcut(e, scriptShortcut)
    const agentName = getAgentName()
    const plainCtrlC = e.code === 'KeyC' && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
    // "Ctrl+C with selection: always send interrupt" leaves Ctrl+Shift+C as the copy key.
    const copiesSelection = !(plainCtrlC && ctrlCSettings().withSelection === 'interrupt')
    const hasSelection = copiesSelection && term.hasSelection?.() === true
    const clip = clipboardActionFor(e, isMac, imagePasteModeFor(agentName) === 'forward', isScript, hasSelection)

    if (clip) {
      e.preventDefault()
      e.stopPropagation()
      if (clip === 'paste-script') {
        void clipboard.pasteScript(canPasteAsPowerShellScript({
          platform: window.omnitermAPI.app.platform,
          connectionType: connection.type,
          shell: connection.shell,
          agentName,
        }))
      } else if (clip === 'paste') {
        if (e.altKey) void clipboard.pasteImage()
        else void clipboard.paste()
      } else {
        void clipboard.copySelection()
        term.clearSelection?.()
      }
      return false
    }

    const exited = getExitedActions?.()
    if (exited && e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      exited.restart()
      return false
    }

    if (e.code === 'KeyC' && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      // A held key repeats keydown well inside the double-press window; it must neither count as a
      // second press nor close the session. The repeat still reaches the process as a plain ^C.
      if (e.repeat) return true
      if (exited || onCtrlC(sessionId, Date.now()) === 'kill') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('omniterm:close-tab', { detail: { id: sessionId } }))
        return false
      }
      if (ctrlCSettings().showHint) onInterruptHint?.()
      return true
    }

    const enterModes = getEnterModes() ?? DEFAULT_ENTER_MODES
    const seq = enterSequenceFor(e, enterModes)
    if (seq !== null) {
      e.preventDefault()
      term.input(seq)
      return false
    }

    const s = resolveShortcuts(shortcuts)
    if (matchesChromeShortcut(e, s, { inTerminal: true })) {
      return false
    }

    return true
  }
}
