/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { installTextReplacementInput } from '../textReplacementInput'

function createTerminal() {
  const element = document.createElement('div')
  const textarea = document.createElement('textarea')
  element.appendChild(textarea)
  document.body.appendChild(element)
  return { element, textarea, input: vi.fn<(data: string) => void>() }
}

/** jsdom does not apply a `beforeinput`'s edit itself; the caller sets the pre-edit selection/value
 * the same way a real browser would have it at the moment `beforeinput` fires. */
function dispatchBeforeInput(textarea: HTMLTextAreaElement, init: {
  inputType: string
  data?: string | null
  isComposing?: boolean
}): InputEvent {
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: init.inputType,
    data: init.data ?? null,
  })
  if (init.isComposing) Object.defineProperty(event, 'isComposing', { value: true })
  textarea.dispatchEvent(event)
  return event
}

function dispatchInput(textarea: HTMLTextAreaElement): void {
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('installTextReplacementInput', () => {
  it('replaces a selected run with one Backspace per code point, then the new text', () => {
    const terminal = createTerminal()
    installTextReplacementInput(terminal, true)
    terminal.textarea.value = 'tieng'
    terminal.textarea.setSelectionRange(0, 5)

    dispatchBeforeInput(terminal.textarea, { inputType: 'insertReplacementText', data: 'tiếng' })

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('\x7f\x7f\x7f\x7f\x7f' + 'tiếng')
  })

  it('forwards a bridged deleteContentBackward as one Backspace when no key press caused it', () => {
    const terminal = createTerminal()
    installTextReplacementInput(terminal, true)
    terminal.textarea.value = 'tiến'
    terminal.textarea.setSelectionRange(4, 4)

    dispatchBeforeInput(terminal.textarea, { inputType: 'deleteContentBackward' })

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('\x7f')
  })

  it('does not double a real Backspace keydown', () => {
    const terminal = createTerminal()
    installTextReplacementInput(terminal, true)
    terminal.textarea.value = 'tiến'
    terminal.textarea.setSelectionRange(4, 4)
    terminal.textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Backspace' }))

    dispatchBeforeInput(terminal.textarea, { inputType: 'deleteContentBackward' })

    expect(terminal.input).not.toHaveBeenCalled()
  })

  it('ignores edits while a composition owns the textarea', () => {
    const terminal = createTerminal()
    installTextReplacementInput(terminal, true)
    terminal.textarea.value = 'tieng'
    terminal.textarea.setSelectionRange(0, 5)

    dispatchBeforeInput(terminal.textarea, { inputType: 'insertReplacementText', data: 'tiếng', isComposing: true })

    expect(terminal.input).not.toHaveBeenCalled()
  })

  it('counts a replaced astral character as one code point, not two UTF-16 units', () => {
    const terminal = createTerminal()
    installTextReplacementInput(terminal, true)
    terminal.textarea.value = '\u{20000}x' // one astral CJK character (2 UTF-16 units) + trailer
    terminal.textarea.setSelectionRange(0, 2)

    dispatchBeforeInput(terminal.textarea, { inputType: 'insertReplacementText', data: '\u{20001}' })

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('\x7f' + '\u{20001}')
  })

  it('swallows the resulting input event so xterm never sees the bridged edit', () => {
    const terminal = createTerminal()
    installTextReplacementInput(terminal, true)
    const xtermInput = vi.fn()
    terminal.textarea.addEventListener('input', xtermInput)
    terminal.textarea.value = 'tieng'
    terminal.textarea.setSelectionRange(0, 5)

    dispatchBeforeInput(terminal.textarea, { inputType: 'insertReplacementText', data: 'tiếng' })
    terminal.textarea.value = 'tiếng'
    dispatchInput(terminal.textarea)

    expect(xtermInput).not.toHaveBeenCalled()
  })

  it('lets an unhandled input event reach xterm normally', () => {
    const terminal = createTerminal()
    installTextReplacementInput(terminal, true)
    const xtermInput = vi.fn()
    terminal.textarea.addEventListener('input', xtermInput)
    terminal.textarea.value = 'tiến'
    terminal.textarea.setSelectionRange(4, 4)
    terminal.textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Backspace' }))

    dispatchBeforeInput(terminal.textarea, { inputType: 'deleteContentBackward' })
    dispatchInput(terminal.textarea)

    expect(xtermInput).toHaveBeenCalledOnce()
  })

  it('does nothing when disabled', () => {
    const terminal = createTerminal()
    installTextReplacementInput(terminal, false)
    terminal.textarea.value = 'tieng'
    terminal.textarea.setSelectionRange(0, 5)

    dispatchBeforeInput(terminal.textarea, { inputType: 'insertReplacementText', data: 'tiếng' })

    expect(terminal.input).not.toHaveBeenCalled()
  })
})
