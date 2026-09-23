/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { installWindowsImeCompositionWorkaround } from '../windowsIme'

function createTerminal() {
  const element = document.createElement('div')
  const textarea = document.createElement('textarea')
  const compositionView = document.createElement('div')
  compositionView.className = 'composition-view'
  element.appendChild(textarea)
  element.appendChild(compositionView)
  document.body.appendChild(element)
  return { element, textarea, compositionView, input: vi.fn<(data: string) => void>() }
}

function dispatchKeydown(textarea: HTMLTextAreaElement, key: string, keyCode: number): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
  Object.defineProperty(event, 'keyCode', { configurable: true, value: keyCode })
  textarea.dispatchEvent(event)
  return event
}

describe('installWindowsImeCompositionWorkaround', () => {
  it('owns the Windows composition and commits the event data once', () => {
    const terminal = createTerminal()
    const xtermCompositionStart = vi.fn()
    const xtermCompositionUpdate = vi.fn()
    const xtermCompositionEnd = vi.fn()
    terminal.textarea.addEventListener('compositionstart', xtermCompositionStart)
    terminal.textarea.addEventListener('compositionupdate', xtermCompositionUpdate)
    terminal.textarea.addEventListener('compositionend', xtermCompositionEnd)
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.value = 'stale-powershell-buffer'
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionupdate', {
      bubbles: true,
      data: 'tiếng Việt',
    }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: 'tiếng Việt',
    }))

    expect(xtermCompositionStart).not.toHaveBeenCalled()
    expect(xtermCompositionUpdate).not.toHaveBeenCalled()
    expect(xtermCompositionEnd).not.toHaveBeenCalled()
    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('tiếng Việt')
    expect(terminal.textarea.value).toBe('')
    expect(terminal.compositionView.classList).not.toContain('active')

    dispose.dispose()
  })

  it('commits a Chinese (Microsoft Pinyin) composition once', () => {
    const terminal = createTerminal()
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '你好' }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }))

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('你好')
    expect(terminal.textarea.value).toBe('')

    dispose.dispose()
  })

  it('commits a Japanese (IME) composition once', () => {
    const terminal = createTerminal()
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'こんにちは' }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'こんにちは' }))

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('こんにちは')
    expect(terminal.textarea.value).toBe('')

    dispose.dispose()
  })

  it('shows a plain, non-selectable composition preview', () => {
    const terminal = createTerminal()
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionupdate', {
      bubbles: true,
      data: 'claude',
    }))

    expect(terminal.compositionView.textContent).toBe('claude')
    expect(terminal.compositionView.classList).toContain('active')
    expect(terminal.compositionView.style.userSelect).toBe('none')
    expect(terminal.compositionView.style.textDecoration).toBe('none')
    expect(terminal.compositionView.style.display).toBe('block')
    expect(terminal.input).not.toHaveBeenCalled()

    dispose.dispose()
  })

  it('refreshes the visible preview when Telex reports the live value through input', () => {
    const terminal = createTerminal()
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.value = 'tieengs'
    terminal.textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertCompositionText',
      data: 's',
    }))

    expect(terminal.compositionView.textContent).toBe('tieengs')
    expect(terminal.compositionView.classList).toContain('active')
    expect(terminal.input).not.toHaveBeenCalled()

    dispose.dispose()
  })

  it('commits the live input preview with a delimiter without replaying it', () => {
    const terminal = createTerminal()
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.value = 'claude'
    terminal.textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertCompositionText',
      data: 'e',
    }))

    dispatchKeydown(terminal.textarea, '-', 189)

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('claude-')
    expect(terminal.compositionView.textContent).toBe('')
    expect(terminal.compositionView.classList).not.toContain('active')

    dispose.dispose()
  })

  it('lets Backspace clear the live composition before typing a new value', () => {
    const terminal = createTerminal()
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.value = 'claude'
    terminal.textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertCompositionText',
      data: 'e',
    }))

    for (const value of ['claud', 'clau', 'cla', 'cl', 'c', '']) {
      const keydown = dispatchKeydown(terminal.textarea, 'Backspace', 8)
      expect(keydown.defaultPrevented).toBe(false)
      terminal.textarea.value = value
      terminal.textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward',
        data: null,
      }))
    }

    expect(terminal.input).not.toHaveBeenCalled()
    expect(terminal.compositionView.textContent).toBe('')

    terminal.textarea.value = 'xin'
    terminal.textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertCompositionText',
      data: 'n',
    }))
    dispatchKeydown(terminal.textarea, '-', 189)

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('xin-')

    dispose.dispose()
  })

  it.each([
    ['space', ' ', 32],
    ['hyphen', '-', 189],
    ['hyphen reported as an IME key', '-', 229],
    ['period', '.', 190],
    ['slash', '/', 191],
    ['underscore', '_', 189],
    ['at sign', '@', 50],
    ['colon', ':', 186],
    ['comma', ',', 188],
    ['semicolon', ';', 186],
    ['opening bracket', '[', 219],
    ['closing bracket', ']', 221],
    ['exclamation mark', '!', 49],
  ])('commits the composition and %s once', (_name, delimiter, keyCode) => {
    const terminal = createTerminal()
    const xtermKeydown = vi.fn()
    terminal.textarea.addEventListener('keydown', xtermKeydown, true)
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionupdate', {
      bubbles: true,
      data: 'claude',
    }))

    const keydown = dispatchKeydown(terminal.textarea, delimiter, keyCode)

    expect(keydown.defaultPrevented).toBe(true)
    expect(xtermKeydown).not.toHaveBeenCalled()
    expect(terminal.input).toHaveBeenCalledExactlyOnceWith(`claude${delimiter}`)

    // Windows may deliver compositionend and the commit input event after the delimiter keydown.
    // Neither event may replay the composition or expose the stale textarea to xterm.
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: 'claude',
    }))
    terminal.textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: 'claude',
    }))
    expect(terminal.input).toHaveBeenCalledExactlyOnceWith(`claude${delimiter}`)

    dispose.dispose()
  })

  it('does not replay a prefix already retained in xterm textarea', () => {
    const terminal = createTerminal()
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    // Windows TSF can report the same whole value that xterm already retained after sending it.
    terminal.textarea.value = 'claude'
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionupdate', {
      bubbles: true,
      data: 'claude',
    }))
    dispatchKeydown(terminal.textarea, '-', 189)

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('-')

    dispose.dispose()
  })

  it('filters a leaked duplicate commit at the terminal data boundary', () => {
    const terminal = createTerminal()
    const forwarded: string[] = []
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)
    terminal.input.mockImplementation(data => {
      if (dispose.shouldForwardData(data)) forwarded.push(data)
    })

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionupdate', {
      bubbles: true,
      data: 'claude',
    }))
    dispatchKeydown(terminal.textarea, '-', 189)

    expect(forwarded).toEqual(['claude-'])
    expect(dispose.shouldForwardData('claude-')).toBe(false)
    expect(dispose.shouldForwardData('-')).toBe(false)
    expect(dispose.shouldForwardData('next-command')).toBe(true)
    dispatchKeydown(terminal.textarea, 'n', 78)
    expect(dispose.shouldForwardData('claude-')).toBe(true)

    dispose.dispose()
  })

  it('drops xterm data that escapes while a composition is active', () => {
    const terminal = createTerminal()
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionupdate', {
      bubbles: true,
      data: 'tiếng Việt',
    }))

    expect(dispose.shouldForwardData('t')).toBe(false)
    expect(dispose.shouldForwardData('iếng Việt')).toBe(false)

    dispose.dispose()
  })

  it('keeps IME keydowns and input events away from xterm until compositionend', () => {
    const terminal = createTerminal()
    const xtermKeydown = vi.fn()
    const xtermInput = vi.fn()
    terminal.textarea.addEventListener('keydown', xtermKeydown, true)
    terminal.textarea.addEventListener('input', xtermInput, true)
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionupdate', {
      bubbles: true,
      data: 'ế',
    }))
    dispatchKeydown(terminal.textarea, 'e', 229)
    terminal.textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertCompositionText',
      data: 'ế',
    }))

    expect(xtermKeydown).not.toHaveBeenCalled()
    expect(xtermInput).not.toHaveBeenCalled()
    expect(terminal.input).not.toHaveBeenCalled()

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: 'ế',
    }))
    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('ế')

    dispose.dispose()
  })

  it('does not swallow the next normal input when no native commit input follows', () => {
    vi.useFakeTimers()
    try {
      const terminal = createTerminal()
      const xtermInput = vi.fn()
      terminal.textarea.addEventListener('input', xtermInput, true)
      const dispose = installWindowsImeCompositionWorkaround(terminal, true)

      terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true,
        data: 'đ',
      }))
      vi.runAllTimers()

      terminal.textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: 'x',
      }))

      expect(xtermInput).toHaveBeenCalledOnce()
      dispose.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves non-Windows input to xterm', () => {
    const terminal = createTerminal()
    const xtermCompositionEnd = vi.fn()
    terminal.textarea.addEventListener('compositionend', xtermCompositionEnd, true)
    const dispose = installWindowsImeCompositionWorkaround(terminal, false)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))

    expect(terminal.input).not.toHaveBeenCalled()
    expect(xtermCompositionEnd).toHaveBeenCalledOnce()

    dispose.dispose()
  })

  it('removes the workaround listener during cleanup', () => {
    const terminal = createTerminal()
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)
    dispose.dispose()

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: 'đ',
    }))

    expect(terminal.input).not.toHaveBeenCalled()
  })
})
