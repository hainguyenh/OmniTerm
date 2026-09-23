import { installTextReplacementInput } from './textReplacementInput'
import { installWindowsImeCompositionWorkaround } from './windowsIme'

interface ImeTerminal {
  readonly element: HTMLElement | undefined
  readonly textarea: HTMLTextAreaElement | undefined
  input(data: string): void
}

export interface ImeInputWorkaround {
  dispose(): void
  shouldForwardData(data: string): boolean
}

/**
 * Picks the per-platform IME handling a pane needs. Windows owns TSF composition itself
 * (windowsIme.ts), because xterm and the Windows IME both read the same hidden textarea and
 * replay each other's edits. macOS and Linux keep xterm's own composition handling — it already
 * works there — and only need the text-replacement bridge for IMEs that edit already-typed text
 * in place (textReplacementInput.ts). Any other platform gets xterm's stock behavior untouched.
 */
export const installImeInput = (terminal: ImeTerminal, platform: string): ImeInputWorkaround => {
  if (platform === 'win32') {
    return installWindowsImeCompositionWorkaround(terminal, true)
  }
  if (platform === 'darwin' || platform === 'linux') {
    const replacement = installTextReplacementInput(terminal, true)
    return { dispose: replacement.dispose, shouldForwardData: () => true }
  }
  return { dispose: () => {}, shouldForwardData: () => true }
}
