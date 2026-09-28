/**
 * Windows IME input for a terminal pane: one bridge for compositions and for the edits an IME makes
 * outside one.
 *
 * xterm 5.5 treats its hidden textarea as both the IME's document and a keystroke buffer, and three
 * of its paths can forward the same text: the keydown textarea diff, the composition helper and the
 * `input` handler. Windows 10/11 Vietnamese Telex types into that textarea, corrects letters in place
 * (`tie` + `e` → `tiê`), may compose a whole word and ends it on a space or a hyphen. Whenever two
 * paths answered one of those edits — or an edit was committed early and the IME re-inserted it —
 * characters were duplicated or lost.
 *
 * Here the textarea mirrors what the PTY has received since the last key xterm sent itself, and each
 * IME edit is forwarded as the difference: one Backspace per changed character, then the new text.
 * The difference sent is recorded, so an edit reported twice (an `input` and a `compositionend`, a
 * repeated commit) finds nothing left to send. A composition is previewed while it is built and sent
 * when the IME ends it; the textarea is never touched while the IME is composing in it. Keys the IME
 * does not claim (Enter, arrows, Ctrl+…) stay xterm's, and the mirror restarts after one because the
 * PTY's line moved on without it.
 */
interface ImeTerminal {
  readonly element: HTMLElement | undefined
  readonly textarea: HTMLTextAreaElement | undefined
  input(data: string): void
}

export interface WindowsImeInput {
  dispose(): void
}

/** The keyCode Chromium reports for a keydown the IME claimed. */
const IME_KEY_CODE = 229
const DEL = '\x7f'
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'NumLock', 'ScrollLock'])
/** Edits an IME makes. Anything else landing in the textarea (a paste, a drop) is not typing. */
const IME_INPUT_TYPES = new Set([
  'insertText',
  'insertReplacementText',
  'insertCompositionText',
  'insertFromComposition',
  'deleteContentBackward',
  'deleteContentForward',
  'deleteCompositionText',
  'deleteByComposition',
])

const commonPrefixLength = (left: readonly string[], right: readonly string[]): number => {
  let length = 0
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1
  return length
}

/**
 * What the PTY must receive to turn `from` into `to`: a Backspace per code point after their common
 * prefix (the PTY deletes one character per Backspace), then the rest of `to`.
 */
export const editBetween = (from: string, to: string): string => {
  const before = Array.from(from)
  const after = Array.from(to)
  const common = commonPrefixLength(before, after)
  return DEL.repeat(before.length - common) + after.slice(common).join('')
}

export const installWindowsImeInput = (terminal: ImeTerminal): WindowsImeInput => {
  const element = terminal.element
  const textarea = terminal.textarea
  if (!element || !textarea) return { dispose: () => {} }

  /** The textarea text the PTY has already received. */
  let sent = ''
  let composing = false
  /** xterm sent a key mid-composition: the mirror restarts once the IME lets go of the textarea. */
  let restartAfterComposition = false
  /** The printable key xterm is handling: its own `input` is xterm's business, not the IME's. */
  let xtermKey: string | null = null

  const compositionView = element.querySelector<HTMLElement>('.composition-view')
  const setPreview = (text: string): void => {
    if (!compositionView) return
    compositionView.style.left = textarea.style.left
    compositionView.style.top = textarea.style.top
    compositionView.style.height = textarea.style.height
    compositionView.style.lineHeight = textarea.style.lineHeight
    compositionView.textContent = text
    compositionView.classList.toggle('active', text.length > 0)
    compositionView.style.display = text.length > 0 ? 'block' : 'none'
    compositionView.style.userSelect = 'none'
    compositionView.style.textDecoration = 'none'
    compositionView.style.pointerEvents = 'none'
  }
  /** The part of the textarea the PTY has not received yet: the composition being built. */
  const unsentText = (): string => {
    const value = Array.from(textarea.value)
    return value.slice(commonPrefixLength(Array.from(sent), value)).join('')
  }

  const setMirror = (value: string): void => {
    textarea.value = value
    textarea.setSelectionRange(value.length, value.length)
    sent = value
  }

  const sync = (): void => {
    const data = editBetween(sent, textarea.value)
    sent = textarea.value
    if (data.length > 0) terminal.input(data)
  }

  /**
   * Every IME edit is synced as it happens, so a textarea that differs from `sent` before the next
   * one was changed by xterm: emptied by a paste, or filled with the selection for a copy menu. None
   * of that is typing to forward.
   */
  const dropForeignText = (): void => {
    if (textarea.value === sent) return
    if (textarea.value.length === 0) sent = ''
    else setMirror('')
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== textarea) return
    if (event.keyCode === IME_KEY_CODE) {
      // The IME's key. xterm would diff the textarea on a timer and resend what it finds.
      event.stopPropagation()
      xtermKey = null
      if (!composing) dropForeignText()
      return
    }
    if (MODIFIER_KEYS.has(event.key)) return
    xtermKey = Array.from(event.key).length === 1 ? event.key : null
    if (composing) {
      // The IME let this key through without ending its composition. Send the composition so far
      // first, so the PTY receives the two in the order they were typed.
      sync()
      restartAfterComposition = true
      return
    }
    const plainBackspace = event.key === 'Backspace' && !event.ctrlKey && !event.altKey && !event.metaKey
    // xterm sends a Backspace itself; the IME must see the character gone too, or its next
    // correction would reach for text the PTY no longer has.
    setMirror(plainBackspace && textarea.value === sent ? Array.from(sent).slice(0, -1).join('') : '')
  }

  const onKeyUp = (): void => {
    xtermKey = null
  }

  // A click can move the PTY cursor (Alt+Click) and the copy menu refills the textarea.
  const onMouseDown = (): void => {
    if (!composing) setMirror('')
  }

  const onBeforeInput = (event: InputEvent): void => {
    if (event.target !== textarea || composing || event.isComposing) return
    if (event.inputType !== 'deleteContentBackward') return
    if (textarea.selectionStart !== 0 || textarea.selectionEnd !== 0) return
    // The IME deletes past the start of what it typed: the textarea has nothing to lose, so no
    // `input` follows, and the PTY's own character needs a Backspace of its own.
    terminal.input(DEL)
  }

  const onInput = (event: Event): void => {
    if (event.target !== textarea) return
    // xterm's own `input` handler would forward the edit a second time.
    event.stopPropagation()
    if (composing) {
      setPreview(unsentText())
      return
    }
    const inputEvent = event as InputEvent
    if (!IME_INPUT_TYPES.has(inputEvent.inputType) || (xtermKey !== null && inputEvent.data === xtermKey)) {
      // A paste or drop, or the default action of a key xterm handled: never the IME's typing.
      setMirror('')
      return
    }
    sync()
  }

  const onCompositionStart = (event: CompositionEvent): void => {
    if (event.target !== textarea) return
    // xterm's offset-based composition helper must never see this composition.
    event.stopPropagation()
    dropForeignText()
    composing = true
    restartAfterComposition = false
    setPreview('')
  }

  const onCompositionUpdate = (event: CompositionEvent): void => {
    if (event.target !== textarea) return
    event.stopPropagation()
    setPreview(unsentText())
  }

  const onCompositionEnd = (event: CompositionEvent): void => {
    if (event.target !== textarea) return
    event.stopPropagation()
    composing = false
    setPreview('')
    sync()
    if (restartAfterComposition) {
      restartAfterComposition = false
      setMirror('')
    }
  }

  // Capture phase on the terminal element: these run before xterm's own listeners on the textarea.
  element.addEventListener('keydown', onKeyDown, true)
  element.addEventListener('keyup', onKeyUp, true)
  element.addEventListener('mousedown', onMouseDown, true)
  element.addEventListener('beforeinput', onBeforeInput, true)
  element.addEventListener('input', onInput, true)
  element.addEventListener('compositionstart', onCompositionStart, true)
  element.addEventListener('compositionupdate', onCompositionUpdate, true)
  element.addEventListener('compositionend', onCompositionEnd, true)
  return {
    dispose: () => {
      setPreview('')
      element.removeEventListener('keydown', onKeyDown, true)
      element.removeEventListener('keyup', onKeyUp, true)
      element.removeEventListener('mousedown', onMouseDown, true)
      element.removeEventListener('beforeinput', onBeforeInput, true)
      element.removeEventListener('input', onInput, true)
      element.removeEventListener('compositionstart', onCompositionStart, true)
      element.removeEventListener('compositionupdate', onCompositionUpdate, true)
      element.removeEventListener('compositionend', onCompositionEnd, true)
    },
  }
}
