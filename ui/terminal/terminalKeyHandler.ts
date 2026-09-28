import type { Terminal } from '@xterm/xterm'

import type { Connection } from '../components/MainLayout'
import { imagePasteModeFor } from '../utils/agentRegistry'
import { DEFAULT_ENTER_MODES, enterSequenceFor, type EnterModes } from '../utils/enterKeys'
import { matchShortcut } from '../utils/keyboard'
import { canPasteAsPowerShellScript, clipboardActionFor } from '../utils/paste'
import { FALLBACK_SHORTCUTS, matchesChromeShortcut, resolveShortcuts } from '../utils/shortcuts'
import type { TerminalClipboard } from '../utils/terminalClipboard'

export interface TerminalKeyHandlerOptions {
  term: Terminal
  clipboard: TerminalClipboard
  connection: Connection
  isMac: boolean
  getAgentName: () => string | null
  getShortcuts: () => Partial<ShortcutBindings> | undefined
  getEnterModes: () => EnterModes | undefined
}

/**
 * Creates the custom key event handler for an xterm instance.
 * Handles clipboard shortcuts, modifier+enter sequences, and app-level shortcut bubbling.
 */
export const createTerminalKeyHandler = ({
  term,
  clipboard,
  connection,
  isMac,
  getAgentName,
  getShortcuts,
  getEnterModes,
}: TerminalKeyHandlerOptions): ((e: KeyboardEvent) => boolean) => {
  return (e: KeyboardEvent) => {
    if (e.type !== 'keydown') return true

    const shortcuts = getShortcuts()
    const scriptShortcut = shortcuts?.pasteScript ?? FALLBACK_SHORTCUTS.pasteScript
    const isScript = matchShortcut(e, scriptShortcut)
    const agentName = getAgentName()
    const clip = clipboardActionFor(e, isMac, imagePasteModeFor(agentName) === 'forward', isScript)

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
      }
      return false
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
