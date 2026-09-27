/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'

import { installImeInput } from '../imeInput'
import { installWindowsImeDirectEdits, type ImeCompositionOwner } from '../windowsImeDirectEdits'

function createTerminal() {
  const element = document.createElement('div')
  const textarea = document.createElement('textarea')
  element.appendChild(textarea)
  document.body.appendChild(element)
  // xterm's own listeners sit on the textarea itself; they must never see the IME's edits.
  const xtermKeydown = vi.fn()
  const xtermInput = vi.fn()
  textarea.addEventListener('keydown', xtermKeydown, true)
  textarea.addEventListener('input', xtermInput, true)
  return { element, textarea, input: vi.fn<(data: string) => void>(), xtermKeydown, xtermInput }
}

type TestTerminal = ReturnType<typeof createTerminal>

const idle: ImeCompositionOwner = { isComposing: () => false, ownsInput: () => false }

function keydown(terminal: TestTerminal, key: string, keyCode: number): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
  Object.defineProperty(event, 'keyCode', { configurable: true, value: keyCode })
  terminal.textarea.dispatchEvent(event)
  return event
}

/** One IME edit as Chromium delivers it: beforeinput, the DOM change, then input. */
function imeEdit(terminal: TestTerminal, inputType: string, data: string | null, value: string, replace?: [number, number]) {
  const { textarea } = terminal
  if (replace) textarea.setSelectionRange(replace[0], replace[1])
  else textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  textarea.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data }))
  textarea.value = value
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data }))
}

/** A keystroke the IME claims (keyCode 229) and answers by inserting `letter`. */
function typeLetter(terminal: TestTerminal, letter: string) {
  keydown(terminal, 'Process', 229)
  imeEdit(terminal, 'insertText', letter, terminal.textarea.value + letter)
}

const sent = (terminal: TestTerminal) => terminal.input.mock.calls.map(([data]) => data).join('')

describe('installWindowsImeDirectEdits', () => {
  it('turns Telex typing and in-place corrections into exactly what was typed (regression: tietiê)', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeDirectEdits(terminal, idle)

    for (const letter of 'tie') typeLetter(terminal, letter)
    // The second `e` makes Telex replace the `e` it typed with `ê`.
    keydown(terminal, 'Process', 229)
    imeEdit(terminal, 'insertText', 'ê', 'tiê', [2, 3])

    expect(sent(terminal)).toBe('tie\x7fê')
    expect(terminal.xtermKeydown).not.toHaveBeenCalled()
    expect(terminal.xtermInput).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it('forwards a replacement edit and an IME deletion as Backspaces', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeDirectEdits(terminal, idle)
    for (const letter of 'tieng') typeLetter(terminal, letter)

    keydown(terminal, 'Process', 229)
    imeEdit(terminal, 'insertReplacementText', 'tiếng', 'tiếng', [0, 5])
    keydown(terminal, 'Process', 229)
    imeEdit(terminal, 'deleteContentBackward', null, 'tiến')

    expect(terminal.input.mock.calls.slice(-2).map(([data]) => data)).toEqual(['\x7f'.repeat(5) + 'tiếng', '\x7f'])
    bridge.dispose()
  })

  it('keeps the textarea in step with keys xterm sends itself', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeDirectEdits(terminal, idle)
    for (const letter of 'viet') typeLetter(terminal, letter)

    expect(keydown(terminal, 'Backspace', 8).defaultPrevented).toBe(false)
    expect(terminal.textarea.value).toBe('vie')
    expect(terminal.xtermKeydown).toHaveBeenCalledTimes(1)
    keydown(terminal, 'Shift', 16)
    expect(terminal.textarea.value).toBe('vie')
    keydown(terminal, 'Enter', 13)
    expect(terminal.textarea.value).toBe('')
    bridge.dispose()
  })

  it('leaves text inserted without an IME keydown to xterm (emoji picker, paste fallbacks)', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeDirectEdits(terminal, idle)
    keydown(terminal, 'a', 65)
    imeEdit(terminal, 'insertText', '😀', '😀')

    expect(terminal.input).not.toHaveBeenCalled()
    expect(terminal.xtermInput).toHaveBeenCalledTimes(1)
    bridge.dispose()
  })

  it('stays out of a composition and of a committed composition’s echo', () => {
    const terminal = createTerminal()
    let composing = true
    const echo = vi.fn(() => !composing)
    const bridge = installWindowsImeDirectEdits(terminal, { isComposing: () => composing, ownsInput: echo })

    keydown(terminal, 'Process', 229)
    imeEdit(terminal, 'insertText', 'v', 'v')
    composing = false
    keydown(terminal, 'Process', 229)
    imeEdit(terminal, 'insertText', 'việt', 'việt')

    expect(terminal.input).not.toHaveBeenCalled()
    expect(echo).toHaveBeenCalled()
    bridge.dispose()
  })

  it('is wired on win32 alongside the composition handling', () => {
    const terminal = createTerminal()
    const workaround = installImeInput(terminal, 'win32')
    typeLetter(terminal, 'o')
    keydown(terminal, 'Process', 229)
    imeEdit(terminal, 'insertText', 'ô', 'ô', [0, 1])

    expect(sent(terminal)).toBe('o\x7fô')
    workaround.dispose()
    typeLetter(terminal, 'x')
    expect(terminal.xtermKeydown).toHaveBeenCalledTimes(1)
  })
})
