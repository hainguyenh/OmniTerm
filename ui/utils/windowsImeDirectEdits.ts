/**
 * Owns the Windows IME edits made outside a composition.
 *
 * Windows 10/11's built-in Vietnamese Telex can type straight into xterm's hidden textarea — a
 * letter, then that letter replaced in place (`e` → `ê`) — after keydowns the IME claims (keyCode
 * 229). xterm answers each claimed keydown by diffing the textarea on a timer, and resends the
 * whole value when an edit keeps its length, so `tie` + `e` reached the PTY as `tietiê`. Keep xterm
 * away from those keydowns and forward each edit the way the PTY would have seen it typed: new text
 * as-is, a replacement as one Backspace per replaced character followed by the new text, and an
 * IME deletion as Backspaces.
 *
 * The textarea keeps what the IME typed, because the IME reads it back to decide its next edit.
 * Keys xterm sends itself keep it in step (a real Backspace drops its last character, any other key
 * clears it), so the IME never edits text the PTY no longer has.
 */
interface DirectEditTerminal {
  readonly element: HTMLElement | undefined
  readonly textarea: HTMLTextAreaElement | undefined
  input(data: string): void
}

/** The composition half (windowsIme.ts): while it owns an edit, this bridge stays out. */
export interface ImeCompositionOwner {
  isComposing(): boolean
  ownsInput(event: InputEvent): boolean
}

export interface WindowsImeDirectEdits {
  dispose(): void
}

/** The keyCode Chromium reports for a keydown the IME consumed. */
const IME_KEY_CODE = 229
const DEL = '\x7f'
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'NumLock', 'ScrollLock'])

/** Code points, not UTF-16 units: the PTY deletes one character per Backspace. */
const codePointLength = (text: string): number => Array.from(text).length

export const installWindowsImeDirectEdits = (
  terminal: DirectEditTerminal,
  composition: ImeCompositionOwner,
): WindowsImeDirectEdits => {
  const element = terminal.element
  const textarea = terminal.textarea
  if (!element || !textarea) return { dispose: () => {} }

  // The IME claimed the latest keydown, so the textarea edits that follow are its typing.
  let imeKeyPending = false
  let handledInput = false

  const setValue = (value: string): void => {
    textarea.value = value
    textarea.setSelectionRange(value.length, value.length)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== textarea || composition.isComposing()) return
    if (event.keyCode === IME_KEY_CODE) {
      imeKeyPending = true
      event.stopPropagation()
      return
    }
    imeKeyPending = false
    if (MODIFIER_KEYS.has(event.key) || textarea.value.length === 0) return
    const plainBackspace = event.key === 'Backspace' && !event.ctrlKey && !event.altKey && !event.metaKey
    setValue(plainBackspace ? Array.from(textarea.value).slice(0, -1).join('') : '')
  }

  const replacedCount = (): number => {
    const start = textarea.selectionStart ?? 0
    const end = textarea.selectionEnd ?? 0
    return end > start ? codePointLength(textarea.value.slice(start, end)) : 0
  }

  /** What the PTY must receive for this edit, or null when it is not the IME's to forward. */
  const translate = (event: InputEvent): string | null => {
    if (event.inputType === 'insertText' || event.inputType === 'insertReplacementText') {
      const text = event.data ?? event.dataTransfer?.getData('text/plain') ?? ''
      return DEL.repeat(replacedCount()) + text
    }
    if (event.inputType === 'deleteContentBackward') return DEL.repeat(Math.max(1, replacedCount()))
    return null
  }

  const onBeforeInput = (event: InputEvent): void => {
    handledInput = false
    if (event.target !== textarea || !imeKeyPending || event.isComposing) return
    if (composition.isComposing() || composition.ownsInput(event)) return
    const data = translate(event)
    if (data === null) return
    handledInput = true
    if (data.length > 0) terminal.input(data)
  }

  // xterm's own `input` listener would send the edit a second time.
  const onInput = (event: Event): void => {
    if (event.target !== textarea || !handledInput) return
    handledInput = false
    event.stopPropagation()
  }

  element.addEventListener('keydown', onKeyDown, true)
  element.addEventListener('beforeinput', onBeforeInput as EventListener, true)
  element.addEventListener('input', onInput, true)
  return {
    dispose: () => {
      element.removeEventListener('keydown', onKeyDown, true)
      element.removeEventListener('beforeinput', onBeforeInput as EventListener, true)
      element.removeEventListener('input', onInput, true)
    },
  }
}
