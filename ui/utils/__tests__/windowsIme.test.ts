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

describe('installWindowsImeCompositionWorkaround', () => {
  it('forwards the committed text once when Windows replaces the whole textarea', () => {
    const terminal = createTerminal()
    const xtermCompositionEnd = vi.fn()
    terminal.textarea.addEventListener('compositionend', xtermCompositionEnd, true)
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.value = '   '
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: 'ếng Việt',
    }))

    expect(terminal.input).toHaveBeenCalledExactlyOnceWith('ếng Việt')
    expect(terminal.textarea.value).toBe('')
    // The synthetic empty event is the only compositionend xterm is allowed to process.
    expect(xtermCompositionEnd).toHaveBeenCalledOnce()

    dispose()
  })

  it('shows the live composition before the IME commits it', () => {
    const terminal = createTerminal()
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    terminal.textarea.dispatchEvent(new CompositionEvent('compositionupdate', {
      bubbles: true,
      data: 'tie',
    }))

    expect(terminal.compositionView.textContent).toBe('tie')
    expect(terminal.compositionView.classList).toContain('active')
    expect(terminal.input).not.toHaveBeenCalled()

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: 'tiế',
    }))
    expect(terminal.compositionView.textContent).toBe('')
    expect(terminal.compositionView.classList).not.toContain('active')

    dispose()
  })

  it('leaves non-Windows and empty commits to xterm', () => {
    const terminal = createTerminal()
    const xtermCompositionEnd = vi.fn()
    terminal.textarea.addEventListener('compositionend', xtermCompositionEnd, true)
    const dispose = installWindowsImeCompositionWorkaround(terminal, false)

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))

    expect(terminal.input).not.toHaveBeenCalled()
    expect(xtermCompositionEnd).toHaveBeenCalledOnce()

    dispose()
  })

  it('removes the workaround listener during cleanup', () => {
    const terminal = createTerminal()
    const dispose = installWindowsImeCompositionWorkaround(terminal, true)
    dispose()

    terminal.textarea.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: 'đ',
    }))

    expect(terminal.input).not.toHaveBeenCalled()
  })
})
