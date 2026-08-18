/** @vitest-environment jsdom */
/**
 * `createTerminalContextMenu` is the seam between xterm's right-click and the link/path overlay.
 * Split from TerminalView so the dispatch behaviour can be exercised without the heavy
 * webgl/effects machinery around it.
 */
import { describe, it, expect, vi } from 'vitest'
import { createTerminalContextMenu } from '../createTerminalContextMenu'
import type { Terminal } from '@xterm/xterm'

/** Build a minimal `onContextMenu` generator with sane default fakes; each test overrides. */
function makeHandler(overrides: {
  term?: Partial<Terminal>
  termEl?: HTMLDivElement | null
  clipboard?: { copySelection: () => void; paste: () => void }
  setLinkMenu?: (state: { x: number; y: number; kind: 'url' | 'path'; text: string }) => void
  setSuppressPaste?: () => void
} = {}) {
  let suppressCalls = 0
  const suppress = () => { suppressCalls += 1 }

  const term = {
    focus: vi.fn(),
    hasSelection: vi.fn(() => false),
    cols: 80,
    rows: 24,
    buffer: {
      active: {
        viewportY: 0,
        getLine: vi.fn(() => ({
          // 'open https://example.test/x here' — URL spans cols 5..26
          translateToString: () => 'open https://example.test/x here',
        })),
      },
    },
    ...overrides.term,
  } as unknown as Terminal

  const termEl = overrides.termEl === undefined ? document.createElement('div') : overrides.termEl
  // Only set the default rect when the harness created the element — a caller-supplied element
  // keeps whatever `getBoundingClientRect` it already has so a test can hit the off-grid branch.
  if (overrides.termEl === undefined) {
    Object.defineProperty(termEl, 'getBoundingClientRect', {
      value: () => ({
        left: 0, top: 0, width: 800, height: 480,
        right: 800, bottom: 480, x: 0, y: 0, toJSON: () => '',
      }),
    })
  }
  const termElRef = { current: termEl }

  const clipboard = overrides.clipboard ?? {
    copySelection: vi.fn(),
    paste: vi.fn(),
  }
  const setLinkMenu = overrides.setLinkMenu ?? vi.fn()
  const handler = createTerminalContextMenu({
    term,
    termElRef,
    clipboard,
    setLinkMenu,
    setSuppressPaste: overrides.setSuppressPaste ?? suppress,
  })
  return {
    handler,
    term,
    clipboard,
    setLinkMenu,
    suppressCalls: () => suppressCalls,
  }
}

describe('createTerminalContextMenu', () => {
  it('opens the link overlay when the right-click lands on a detected URL', () => {
    const { handler, setLinkMenu, clipboard, suppressCalls, term } = makeHandler()
    const e = {
      preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(),
      clientX: 60, clientY: 6, // URL starts at col 5 (~x=50); col 6 → x≈60
    } as unknown as MouseEvent

    handler(e)

    expect(setLinkMenu).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'url', text: 'https://example.test/x' }),
    )
    expect(term.focus).toHaveBeenCalled()
    expect(clipboard.copySelection).not.toHaveBeenCalled()
    expect(clipboard.paste).not.toHaveBeenCalled()
    expect(suppressCalls()).toBe(0)
  })

  it('honours an explicit termElRef.current that classicifies the click as outside the grid (null)', () => {
    // Disable detection by giving the ref an off-target rect: click outside the element.
    const termEl = document.createElement('div')
    Object.defineProperty(termEl, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 100, width: 800, height: 480, right: 900, bottom: 580, x: 100, y: 100, toJSON: () => '' }),
    })
    const { handler, setLinkMenu, clipboard, term } = makeHandler({ termEl })

    const e = {
      preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(),
      // Click above the rect (y=50 < top=100): detector returns null; fall to paste branch.
      clientX: 200, clientY: 50,
    } as unknown as MouseEvent

    handler(e)

    expect(setLinkMenu).not.toHaveBeenCalled()
    expect(term.focus).toHaveBeenCalled()
    expect(clipboard.paste).toHaveBeenCalled()
  })

  it('copies selection when the right-click misses a link AND the pane has a selection', () => {
    const clipboard = { copySelection: vi.fn(), paste: vi.fn() }
    const { handler, setLinkMenu } = makeHandler({
      clipboard,
      // Selection held — hasSelection=true drives the copy branch even when nothing is detected.
      term: { hasSelection: () => true } as Partial<Terminal>,
    })

    const e = {
      preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(),
      // The mocked line has its URL spanning cols 5..25 and a path regex span only up to col 27; a
      // click at col 30 lands past all matches, so detection returns null and the copy branch fires.
      clientX: 300, clientY: 6,
    } as unknown as MouseEvent

    handler(e)
    expect(setLinkMenu).not.toHaveBeenCalled()
    expect(clipboard.copySelection).toHaveBeenCalled()
    expect(clipboard.paste).not.toHaveBeenCalled()
  })

  it('calls preventDefault / stopPropagation for both branches (so the browser context menu never opens)', () => {
    const { handler: urlHandler, setLinkMenu: urlSet } = makeHandler()
    const pasteClipboard = { copySelection: vi.fn(), paste: vi.fn() }
    const { handler: pasteHandler } = makeHandler({
      term: { hasSelection: () => false } as Partial<Terminal>,
      clipboard: pasteClipboard,
    })

    const e1 = {
      preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(),
      clientX: 60, clientY: 6,
    } as unknown as MouseEvent
    urlHandler(e1)
    expect(urlSet).toHaveBeenCalled()
    expect(e1.preventDefault).toHaveBeenCalled()
    expect(e1.stopPropagation).toHaveBeenCalled()

    const e2 = {
      preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(),
      clientX: 700, clientY: 6,
    } as unknown as MouseEvent
    pasteHandler(e2)
    expect(e2.preventDefault).toHaveBeenCalled()
    expect(e2.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('arms the native-paste suppression window only when the paste branch is taken', () => {
    const urlSuppress = vi.fn()
    const pasteSuppress = vi.fn()
    const { handler: urlHandler } = makeHandler({ setSuppressPaste: urlSuppress })
    const { handler: pasteHandler } = makeHandler({
      term: { hasSelection: () => false } as Partial<Terminal>,
      clipboard: { copySelection: vi.fn(), paste: vi.fn() },
      setSuppressPaste: pasteSuppress,
    })

    const onUrl = {
      preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(),
      clientX: 60, clientY: 6,
    } as unknown as MouseEvent
    urlHandler(onUrl)
    expect(urlSuppress).not.toHaveBeenCalled()

    const onPaste = {
      preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(),
      clientX: 700, clientY: 6,
    } as unknown as MouseEvent
    pasteHandler(onPaste)
    expect(pasteSuppress).toHaveBeenCalledOnce()
  })
})
