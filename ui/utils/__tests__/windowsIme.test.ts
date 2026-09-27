/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'

import { installImeInput } from '../imeInput'
import { editBetween, installWindowsImeInput } from '../windowsIme'

const DEL = '\x7f'

/**
 * A pane as the bridge sees it. xterm's own listeners sit on the textarea: its keydown "sends" the
 * keys it handles (and cancels them, as xterm does), its input handler would forward insertText.
 * `pty` is everything the PTY received, from either side, in order.
 */
function createTerminal() {
  const element = document.createElement('div')
  const textarea = document.createElement('textarea')
  const compositionView = document.createElement('div')
  compositionView.className = 'composition-view'
  element.append(textarea, compositionView)
  document.body.appendChild(element)
  const pty: string[] = []
  const xtermKeydown = vi.fn((event: KeyboardEvent) => {
    const data = event.key === 'Backspace' ? DEL : event.key === 'Enter' ? '\r' : event.key.length === 1 ? event.key : ''
    if (data) {
      pty.push(data)
      event.preventDefault()
    }
  })
  const xtermInput = vi.fn()
  const xtermComposition = vi.fn()
  textarea.addEventListener('keydown', xtermKeydown)
  textarea.addEventListener('input', xtermInput)
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) textarea.addEventListener(type, xtermComposition)
  const input = vi.fn((data: string) => { pty.push(data) })
  return { element, textarea, compositionView, input, pty, xtermKeydown, xtermInput, xtermComposition }
}

type TestTerminal = ReturnType<typeof createTerminal>

/** The line the shell ends up with: every Backspace removes one character. */
const line = (terminal: TestTerminal): string => {
  const chars: string[] = []
  for (const char of Array.from(terminal.pty.join(''))) {
    if (char === DEL) chars.pop()
    else chars.push(char)
  }
  return chars.join('')
}

function keydown(terminal: TestTerminal, key: string, keyCode: number): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
  Object.defineProperty(event, 'keyCode', { configurable: true, value: keyCode })
  terminal.textarea.dispatchEvent(event)
  return event
}

const keyup = (terminal: TestTerminal) => terminal.textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))

/** One textarea edit as Chromium delivers it: beforeinput, the DOM change, then input. */
function edit(terminal: TestTerminal, inputType: string, data: string | null, value: string, replace?: [number, number]) {
  const { textarea } = terminal
  if (replace) textarea.setSelectionRange(replace[0], replace[1])
  else textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  textarea.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data }))
  textarea.value = value
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data }))
}

/** A keystroke the IME claims (keyCode 229) and answers by typing `letter` into the textarea. */
function typeLetter(terminal: TestTerminal, letter: string) {
  keydown(terminal, 'Process', 229)
  edit(terminal, 'insertText', letter, terminal.textarea.value + letter)
}

const composition = (terminal: TestTerminal, type: 'compositionstart' | 'compositionupdate' | 'compositionend', data = '') =>
  terminal.textarea.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }))

/** A Telex composition growing letter by letter, as Chromium reports it. */
function compose(terminal: TestTerminal, base: string, steps: string[]) {
  composition(terminal, 'compositionstart')
  for (const step of steps) {
    keydown(terminal, 'Process', 229)
    terminal.textarea.value = base + step
    terminal.textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: step }))
    composition(terminal, 'compositionupdate', step)
  }
}

describe('editBetween', () => {
  it('backspaces to the common prefix, by code point, then types the rest', () => {
    expect(editBetween('tie', 'tiê')).toBe(`${DEL}ê`)
    expect(editBetween('tieng', 'tiếng')).toBe(`${DEL.repeat(3)}ếng`)
    expect(editBetween('a😀', 'a')).toBe(DEL)
    expect(editBetween('', 'việt')).toBe('việt')
    expect(editBetween('same', 'same')).toBe('')
  })
})

describe('installWindowsImeInput — edits outside a composition', () => {
  it('turns Telex typing and in-place corrections into exactly what was typed (regression: tietiê)', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)

    for (const letter of 'tie') typeLetter(terminal, letter)
    keydown(terminal, 'Process', 229)
    edit(terminal, 'insertText', 'ê', 'tiê', [2, 3])

    expect(terminal.pty.join('')).toBe(`tie${DEL}ê`)
    expect(terminal.xtermKeydown).not.toHaveBeenCalled()
    expect(terminal.xtermInput).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it('forwards a whole-word replacement and an IME deletion as the difference', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    for (const letter of 'tieng') typeLetter(terminal, letter)

    keydown(terminal, 'Process', 229)
    edit(terminal, 'insertReplacementText', 'tiếng', 'tiếng', [0, 5])
    keydown(terminal, 'Process', 229)
    edit(terminal, 'deleteContentBackward', null, 'tiến')

    expect(line(terminal)).toBe('tiến')
    bridge.dispose()
  })

  it('never sends an edit twice, however often it is reported', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    for (const letter of 'xin') typeLetter(terminal, letter)
    // The same value reported again, as a repeated input and an echo after a commit.
    terminal.textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'n' }))
    composition(terminal, 'compositionend', 'xin')

    expect(terminal.pty.join('')).toBe('xin')
    bridge.dispose()
  })

  it.each([
    ['space', ' ', 32],
    ['hyphen', '-', 189],
    ['period', '.', 190],
    ['slash', '/', 191],
    ['at sign', '@', 50],
  ])('keeps word, %s and the next word in order when xterm sends the delimiter', (_name, delimiter, keyCode) => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    for (const letter of 'viet') typeLetter(terminal, letter)
    keydown(terminal, 'Process', 229)
    edit(terminal, 'insertText', 'ệ', 'việt', [2, 3])

    expect(keydown(terminal, delimiter, keyCode).defaultPrevented).toBe(true)
    expect(terminal.textarea.value).toBe('')
    for (const letter of 'nam') typeLetter(terminal, letter)

    expect(line(terminal)).toBe(`việt${delimiter}nam`)
    bridge.dispose()
  })

  it('forwards a delimiter the IME types itself exactly once', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    for (const letter of 'ok') typeLetter(terminal, letter)
    typeLetter(terminal, ' ')
    typeLetter(terminal, '-')

    expect(line(terminal)).toBe('ok -')
    bridge.dispose()
  })

  it('keeps the mirror in step with keys xterm sends itself', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    for (const letter of 'viet') typeLetter(terminal, letter)

    keydown(terminal, 'Backspace', 8)
    expect(terminal.textarea.value).toBe('vie')
    keydown(terminal, 'Shift', 16)
    expect(terminal.textarea.value).toBe('vie')
    // The IME corrects the text the PTY still has: `vie` + `e` → `viê`.
    keydown(terminal, 'Process', 229)
    edit(terminal, 'insertText', 'ê', 'viê', [2, 3])
    expect(line(terminal)).toBe('viê')

    keydown(terminal, 'Enter', 13)
    expect(terminal.textarea.value).toBe('')
    expect(line(terminal)).toBe('viê\r')
    bridge.dispose()
  })

  it('sends a Backspace the IME makes on an empty textarea', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    keydown(terminal, 'Process', 229)
    terminal.textarea.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }))

    expect(terminal.pty).toEqual([DEL])
    bridge.dispose()
  })

  it('ignores the default action of a key xterm handled, and pastes or drops into the textarea', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    terminal.xtermKeydown.mockImplementation(() => {})
    keydown(terminal, 'q', 81)
    edit(terminal, 'insertText', 'q', 'q')
    keyup(terminal)
    edit(terminal, 'insertFromPaste', null, 'pasted')
    edit(terminal, 'insertFromDrop', null, 'dropped')

    expect(terminal.input).not.toHaveBeenCalled()
    expect(terminal.textarea.value).toBe('')
    bridge.dispose()
  })

  it('forwards text inserted without a keystroke (emoji panel)', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    keydown(terminal, '.', 190)
    keyup(terminal)
    edit(terminal, 'insertText', '😀', '😀')

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('😀')
    bridge.dispose()
  })

  it('does not forward or backspace over text xterm put in the textarea itself', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    for (const letter of 'ab') typeLetter(terminal, letter)
    // xterm's paste empties the textarea after sending the clipboard itself.
    terminal.textarea.value = ''
    typeLetter(terminal, 'c')
    // Its copy menu fills it with the selection.
    terminal.textarea.value = 'selected'
    keydown(terminal, 'Enter', 13)

    expect(terminal.input.mock.calls.map(([data]) => data)).toEqual(['a', 'b', 'c'])
    bridge.dispose()
  })

  it('restarts the mirror on a click, which may move the PTY cursor', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    typeLetter(terminal, 'a')
    terminal.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(terminal.textarea.value).toBe('')
    bridge.dispose()
  })
})

describe('installWindowsImeInput — compositions', () => {
  it('previews a composition and sends it once when the IME ends it', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    compose(terminal, '', ['t', 'ti', 'tie', 'tiê', 'tiên', 'tiêng', 'tiếng'])

    expect(terminal.input).not.toHaveBeenCalled()
    expect(terminal.compositionView.textContent).toBe('tiếng')
    expect(terminal.compositionView.classList).toContain('active')
    expect(terminal.compositionView.style.userSelect).toBe('none')

    composition(terminal, 'compositionend', 'tiếng')
    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('tiếng')
    expect(terminal.compositionView.classList).not.toContain('active')
    expect(terminal.xtermComposition).not.toHaveBeenCalled()
    expect(terminal.xtermKeydown).not.toHaveBeenCalled()
    expect(terminal.xtermInput).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it('does not respawn a word the IME commits again after a space (regression)', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    compose(terminal, '', ['c', 'cl', 'cla', 'clau', 'claud', 'claude'])
    // Space: the IME ends the composition, types the space, then re-reports the commit.
    keydown(terminal, ' ', 229)
    composition(terminal, 'compositionend', 'claude')
    edit(terminal, 'insertText', ' ', 'claude ')
    terminal.textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'claude' }))

    expect(line(terminal)).toBe('claude ')
    bridge.dispose()
  })

  it('keeps the order when the IME lets a delimiter through mid-composition', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    compose(terminal, '', ['x', 'xi', 'xin'])
    keydown(terminal, '-', 189)
    composition(terminal, 'compositionend', 'xin')
    for (const letter of 'chao') typeLetter(terminal, letter)

    expect(line(terminal)).toBe('xin-chao')
    expect(terminal.textarea.value).toBe('chao')
    bridge.dispose()
  })

  it('backspaces over committed text the IME recomposes', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    for (const letter of 'tieng') typeLetter(terminal, letter)
    // Telex reopens the word to place the tone mark.
    compose(terminal, '', ['tiếng'])
    expect(terminal.compositionView.textContent).toBe('ếng')
    composition(terminal, 'compositionend', 'tiếng')

    expect(line(terminal)).toBe('tiếng')
    bridge.dispose()
  })

  it('lets Backspace edit the composition without sending anything', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    compose(terminal, '', ['c', 'cl', 'cla', 'cl', 'c', 'x'])
    composition(terminal, 'compositionend', 'x')

    expect(terminal.pty).toEqual(['x'])
    bridge.dispose()
  })

  it('commits CJK compositions once', () => {
    const terminal = createTerminal()
    const bridge = installWindowsImeInput(terminal)
    compose(terminal, '', ['n', 'ni', '你好'])
    composition(terminal, 'compositionend', '你好')
    keydown(terminal, 'Enter', 13)
    compose(terminal, '', ['こんにちは'])
    composition(terminal, 'compositionend', 'こんにちは')

    expect(terminal.pty).toEqual(['你好', '\r', 'こんにちは'])
    bridge.dispose()
  })
})

describe('installWindowsImeInput — lifecycle', () => {
  it('is wired on win32 and removes every listener on dispose', () => {
    const terminal = createTerminal()
    const workaround = installImeInput(terminal, 'win32')
    typeLetter(terminal, 'o')
    keydown(terminal, 'Process', 229)
    edit(terminal, 'insertText', 'ô', 'ô', [0, 1])
    expect(terminal.pty.join('')).toBe(`o${DEL}ô`)

    workaround.dispose()
    typeLetter(terminal, 'x')
    expect(terminal.xtermKeydown).toHaveBeenCalledTimes(1)
    expect(terminal.xtermInput).toHaveBeenCalled()
  })

  it('is a no-op without a textarea', () => {
    const bridge = installWindowsImeInput({ element: undefined, textarea: undefined, input: vi.fn() })
    expect(() => bridge.dispose()).not.toThrow()
  })
})
