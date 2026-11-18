/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { externalHref, installExternalLinkGuard } from '../externalLinkGuard'

const ORIGIN = 'http://tauri.localhost'

describe('externalHref', () => {
  it('takes web and mail links outside the app, nothing else', () => {
    expect(externalHref('https://example.test/a?b=1', ORIGIN)).toBe('https://example.test/a?b=1')
    expect(externalHref('mailto:someone@example.test', ORIGIN)).toBe('mailto:someone@example.test')
    expect(externalHref('/settings', ORIGIN)).toBeNull()
    expect(externalHref(`${ORIGIN}/index.html#x`, ORIGIN)).toBeNull()
    expect(externalHref('#top', ORIGIN)).toBeNull()
    expect(externalHref('javascript:alert(1)', ORIGIN)).toBeNull()
    expect(externalHref('blob:http://tauri.localhost/1', ORIGIN)).toBeNull()
    expect(externalHref(undefined, ORIGIN)).toBeNull()
  })
})

// Regression: opening a URL from a terminal pane loaded the page inside the app window, taking
// over the whole UI with no way back, instead of the system browser.
describe('installExternalLinkGuard', () => {
  let uninstall = () => {}
  afterEach(() => {
    uninstall()
    document.body.innerHTML = ''
  })

  it('sends window.open of a web page to the system browser', () => {
    const open = vi.fn(async () => undefined)
    uninstall = installExternalLinkGuard(window, open)

    expect(window.open('https://example.test/docs', '_blank', 'noopener')).toBeNull()
    expect(open).toHaveBeenCalledWith('https://example.test/docs')
  })

  it('opens a clicked external link outside, and leaves a handled or internal one alone', () => {
    const open = vi.fn(async () => undefined)
    uninstall = installExternalLinkGuard(window, open)
    document.body.innerHTML =
      '<a id="ext" href="https://example.test/x"><span id="inner">x</span></a><a id="own" href="#part">y</a>'

    const click = (id: string, handled = false) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      if (handled) event.preventDefault()
      document.getElementById(id)!.dispatchEvent(event)
      return event
    }

    expect(click('inner').defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledWith('https://example.test/x')
    open.mockClear()
    click('own')
    click('ext', true)
    expect(open).not.toHaveBeenCalled()
  })
})
