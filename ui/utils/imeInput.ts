import { installTextReplacementInput } from './textReplacementInput'
import { installWindowsImeInput } from './windowsIme'

interface ImeTerminal {
  readonly element: HTMLElement | undefined
  readonly textarea: HTMLTextAreaElement | undefined
  input(data: string): void
}

export interface ImeInputWorkaround {
  dispose(): void
}

/**
 * Picks the per-platform IME handling a pane needs. Windows forwards every IME edit itself
 * (windowsIme.ts) — compositions and the Telex-style in-place corrections alike — because xterm
 * and the Windows IME both read the same hidden textarea and replay each other's edits. macOS and
 * Linux keep xterm's own composition handling — it already works there — and only need the
 * text-replacement bridge for IMEs that edit already-typed text in place (textReplacementInput.ts).
 * Any other platform gets xterm's stock behavior untouched.
 *
 * NOTE (Vietnamese Telex & AI Agents):
 * Typing and IME composition handling is installed here at the terminal/xterm DOM layer across all
 * panes, preventing xterm and the OS IME from duplicating in-place corrections (e.g. `tie` + `e` -> `tietiê`).
 * The AI Agents themselves do not intercept or transform keystrokes in OmniTerm — they receive the PTY
 * stdin stream forwarded by xterm. If an agent handles raw IME input by itself or if this workaround
 * needs to be bypassed or reverted for specific agents in the future, modify or guard this bridge.
 */
export const installImeInput = (terminal: ImeTerminal, platform: string): ImeInputWorkaround => {
  if (platform === 'win32') return installWindowsImeInput(terminal)
  if (platform === 'darwin' || platform === 'linux') return installTextReplacementInput(terminal, true)
  return { dispose: () => {} }
}
