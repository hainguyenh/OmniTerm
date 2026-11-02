/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { showPixelCopiedToast } from '../pixelCopiedToast'

describe('pixelCopiedToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('renders a retro pixel toast element into the document body', () => {
    showPixelCopiedToast(120, 240)

    const toast = document.querySelector('[data-pixel-copied-toast="true"]') as HTMLElement | null
    expect(toast).not.toBeNull()
    expect(toast?.textContent).toBe('Copied')
    expect(toast?.style.left).toBe('120px')
    expect(toast?.style.top).toBe('240px')
    expect(toast?.getAttribute('role')).toBe('status')
  })

  it('clamps coordinates to stay within the viewport', () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true })

    showPixelCopiedToast(0, 0)
    let toast = document.querySelector('[data-pixel-copied-toast="true"]') as HTMLElement | null
    expect(toast?.style.left).toBe('36px')
    expect(toast?.style.top).toBe('30px')
    toast?.remove()

    showPixelCopiedToast(1000, 1000)
    toast = document.querySelector('[data-pixel-copied-toast="true"]') as HTMLElement | null
    expect(toast?.style.left).toBe('464px')
    expect(toast?.style.top).toBe('376px')
  })

  it('automatically removes the toast element after timeout', () => {
    showPixelCopiedToast(150, 200)

    expect(document.querySelector('[data-pixel-copied-toast="true"]')).not.toBeNull()

    vi.advanceTimersByTime(550)

    expect(document.querySelector('[data-pixel-copied-toast="true"]')).toBeNull()
  })

  it('only injects the stylesheet once for multiple toasts', () => {
    showPixelCopiedToast(50, 50)
    showPixelCopiedToast(100, 100)

    const styles = document.querySelectorAll('style#omniterm-pixel-copied-toast-style')
    expect(styles.length).toBe(1)
  })

  it('renders square toast with 0 border-radius under TLR / theme-square / theme-terminal-paper', () => {
    document.documentElement.classList.add('theme-terminal-paper')
    showPixelCopiedToast(80, 80)

    const toast = document.querySelector('[data-pixel-copied-toast="true"]') as HTMLElement | null
    expect(toast).not.toBeNull()
    expect(toast?.classList.contains('toast-square')).toBe(true)
    expect(toast?.style.borderRadius).toBe('0px')

    document.documentElement.classList.remove('theme-terminal-paper')
  })
})
