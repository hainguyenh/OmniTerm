/**
 * Bridges the macOS/Linux Vietnamese IME edits xterm's own composition handling drops.
 *
 * xterm forwards a hidden-textarea edit only when the value grew (its `input` listener only acts
 * on `insertText`), so an IME that corrects already-typed text in place — ibus-bamboo and
 * fcitx5-unikey in surrounding-text mode on Linux, or a macOS input source that replaces the
 * previous characters — never reaches the PTY. Composition-based IMEs (macOS Telex/VNI marked
 * text, ibus-bamboo/fcitx5-unikey pre-edit mode) and IMEs that send a real Backspace keydown
 * (OpenKey, EVKey) already work through xterm's stock path and are left untouched here.
 */
interface TextReplacementTerminal {
  readonly element: HTMLElement | undefined
  readonly textarea: HTMLTextAreaElement | undefined
  input(data: string): void
}

export interface TextReplacementInputWorkaround {
  dispose(): void
}

/** Unicode code points, not UTF-16 units — a replaced astral character sends one Backspace. */
const codePointLength = (text: string): number => Array.from(text).length

export const installTextReplacementInput = (
  terminal: TextReplacementTerminal,
  enabled: boolean,
): TextReplacementInputWorkaround => {
  const element = terminal.element
  const textarea = terminal.textarea
  if (!enabled || !element || !textarea) {
    return { dispose: () => {} }
  }

  let keyDeleteSeen = false
  let keyDeleteResetTimer: number | undefined
  let handledLastBeforeInput = false

  const armKeyDeleteSeen = (): void => {
    keyDeleteSeen = true
    if (keyDeleteResetTimer !== undefined) window.clearTimeout(keyDeleteResetTimer)
    keyDeleteResetTimer = window.setTimeout(() => {
      keyDeleteSeen = false
      keyDeleteResetTimer = undefined
    }, 0)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== textarea) return
    if (event.key === 'Backspace' || event.key === 'Delete') armKeyDeleteSeen()
  }

  /** Code points about to be removed: the selection if there is one, else one character back. */
  const deletedCodePointCount = (): number => {
    const start = textarea.selectionStart ?? 0
    const end = textarea.selectionEnd ?? 0
    if (end > start) return codePointLength(textarea.value.slice(start, end))
    return 1
  }

  const onBeforeInput = (event: InputEvent): void => {
    if (event.target !== textarea) return
    handledLastBeforeInput = false
    if (event.isComposing) return

    if (event.inputType === 'deleteContentBackward') {
      if (keyDeleteSeen) return
      terminal.input('\x7f'.repeat(deletedCodePointCount()))
      handledLastBeforeInput = true
      event.stopImmediatePropagation()
      return
    }

    const start = textarea.selectionStart ?? 0
    const end = textarea.selectionEnd ?? 0
    const hasSelection = end > start
    if (event.inputType === 'insertReplacementText' || (event.inputType === 'insertText' && hasSelection)) {
      const deletedCount = hasSelection ? codePointLength(textarea.value.slice(start, end)) : 0
      const data = event.data ?? event.dataTransfer?.getData('text/plain') ?? ''
      terminal.input('\x7f'.repeat(deletedCount) + data)
      handledLastBeforeInput = true
      event.stopImmediatePropagation()
    }
  }

  // xterm's own `input` listener sits on the textarea itself; ours is on the ancestor `element` in
  // the capture phase, so stopping propagation here keeps the DOM mutation (real browsers only,
  // not this bridge) from also being replayed by xterm's textarea diff.
  const onInput = (event: Event): void => {
    if (event.target !== textarea) return
    if (handledLastBeforeInput) {
      event.stopImmediatePropagation()
      handledLastBeforeInput = false
    }
  }

  element.addEventListener('keydown', onKeyDown, true)
  element.addEventListener('beforeinput', onBeforeInput as EventListener, true)
  element.addEventListener('input', onInput, true)

  const dispose = (): void => {
    if (keyDeleteResetTimer !== undefined) window.clearTimeout(keyDeleteResetTimer)
    element.removeEventListener('keydown', onKeyDown, true)
    element.removeEventListener('beforeinput', onBeforeInput as EventListener, true)
    element.removeEventListener('input', onInput, true)
  }
  return { dispose }
}
