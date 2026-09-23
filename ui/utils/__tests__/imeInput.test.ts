/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { installImeInput } from '../imeInput'

function createTerminal() {
  const element = document.createElement('div')
  const textarea = document.createElement('textarea')
  const compositionView = document.createElement('div')
  compositionView.className = 'composition-view'
  element.appendChild(textarea)
  element.appendChild(compositionView)
  document.body.appendChild(element)
  return { element, textarea, input: vi.fn<(data: string) => void>() }
}

describe('installImeInput', () => {
  it('owns Windows composition on win32', () => {
    const terminal = createTerminal()
    const workaround = installImeInput(terminal, 'win32')

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }))

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('你好')
    expect(workaround.shouldForwardData('你好')).toBe(false)
    workaround.dispose()
  })

  it('bridges text replacement on darwin without touching shouldForwardData', () => {
    const terminal = createTerminal()
    const workaround = installImeInput(terminal, 'darwin')
    terminal.textarea.value = 'tieng'
    terminal.textarea.setSelectionRange(0, 5)

    terminal.textarea.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertReplacementText',
      data: 'tiếng',
    }))

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('\x7f\x7f\x7f\x7f\x7f' + 'tiếng')
    expect(workaround.shouldForwardData('anything')).toBe(true)
    workaround.dispose()
  })

  it('bridges text replacement on linux the same way', () => {
    const terminal = createTerminal()
    const workaround = installImeInput(terminal, 'linux')
    terminal.textarea.value = 'a'
    terminal.textarea.setSelectionRange(0, 1)

    terminal.textarea.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertReplacementText',
      data: 'á',
    }))

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('\x7fá')
    workaround.dispose()
  })

  it('is a no-op on an unrecognized platform', () => {
    const terminal = createTerminal()
    const workaround = installImeInput(terminal, 'freebsd')
    terminal.textarea.value = 'a'
    terminal.textarea.setSelectionRange(0, 1)

    terminal.textarea.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertReplacementText',
      data: 'á',
    }))

    expect(terminal.input).not.toHaveBeenCalled()
    expect(workaround.shouldForwardData('anything')).toBe(true)
    workaround.dispose()
  })
})
