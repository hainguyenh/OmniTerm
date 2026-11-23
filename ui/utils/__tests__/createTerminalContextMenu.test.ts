/** @vitest-environment jsdom */
/**
 * `createTerminalContextMenu` is the seam between xterm's right-click / link-modifier click and the
 * link/path overlay. Split from TerminalView so the dispatch behaviour can be exercised without the
 * heavy webgl/effects machinery around it.
 */
import { describe, it, expect, vi } from 'vitest'
import { createTerminalContextMenu } from '../createTerminalContextMenu'
import type { Terminal } from '@xterm/xterm'

/** Build a minimal handler factory with sane default fakes; each test overrides. */
function makeHandler(overrides: {
  term?: Partial<Terminal>
  termEl?: HTMLDivElement | null
  clipboard?: { copySelection: () => void; paste: () => void }
  setLinkMenu?: (state: { x: number; y: number; kind: 'url' | 'path'; text: string }) => void
  setSuppressPaste?: () => void
  openPath?: (link: { text: string; line?: number; col?: number }) => void
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
  const { onContextMenu, onLinkClick, linkHandler } = createTerminalContextMenu({
    term,
    termElRef,
    clipboard,
    setLinkMenu,
    setSuppressPaste: overrides.setSuppressPaste ?? suppress,
    ...(overrides.openPath ? { openPath: overrides.openPath } : {}),
  })
  return {
    onContextMenu,
    onLinkClick,
    linkHandler,
    term,
    clipboard,
    setLinkMenu,
    suppressCalls: () => suppressCalls,
  }
}

/** Non-Mac event stub (Ctrl is the platform link-modifier on jsdom's default platform). */
const click = (overrides: Partial<MouseEvent>): MouseEvent => ({
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  stopImmediatePropagation: vi.fn(),
  ctrlKey: false,
  metaKey: false,
  button: 0,
  ...overrides,
} as unknown as MouseEvent)

describe('createTerminalContextMenu — onLinkClick', () => {
  it('opens the link overlay when the platform modifier + left-click lands on a detected URL', () => {
    const { onLinkClick, setLinkMenu, clipboard, suppressCalls, term } = makeHandler()
    // URL starts at col 5 (~x=50); col 6 → x≈60. Ctrl held as the non-Mac link modifier.
    const e = click({ ctrlKey: true, button: 0, clientX: 60, clientY: 6 })

    onLinkClick(e)

    expect(setLinkMenu).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'url', text: 'https://example.test/x' }),
    )
    expect(term.focus).toHaveBeenCalled()
    expect(clipboard.copySelection).not.toHaveBeenCalled()
    expect(clipboard.paste).not.toHaveBeenCalled()
    expect(suppressCalls()).toBe(0)
  })

  it('ignores clicks without the platform link-modifier (preserve xterm selection/caret)', () => {
    const { onLinkClick, setLinkMenu, clipboard, term } = makeHandler()
    // No Ctrl/Cmd held: the handler returns early so xterm keeps its default click behaviour.
    const e = click({ ctrlKey: false, metaKey: false, button: 0, clientX: 60, clientY: 6 })

    onLinkClick(e)

    expect(setLinkMenu).not.toHaveBeenCalled()
    expect(term.focus).not.toHaveBeenCalled()
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(clipboard.copySelection).not.toHaveBeenCalled()
    expect(clipboard.paste).not.toHaveBeenCalled()
  })

  it('ignores non-left clicks (e.g. Ctrl + right-button does not open the overlay)', () => {
    const { onLinkClick, setLinkMenu } = makeHandler()
    const e = click({ ctrlKey: true, button: 2, clientX: 60, clientY: 6 })

    onLinkClick(e)

    expect(setLinkMenu).not.toHaveBeenCalled()
    // Selection fallback should not be eaten either — no suppression of xterm's own behaviour.
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('ignores modifier clicks that land outside the grid (no termEl ref)', () => {
    // termEl ref is null — the handler must bail without touching state.
    const { onLinkClick, setLinkMenu, clipboard, term } = makeHandler({ termEl: null })

    onLinkClick(click({ ctrlKey: true, button: 0, clientX: 60, clientY: 6 }))

    expect(setLinkMenu).not.toHaveBeenCalled()
    expect(term.focus).not.toHaveBeenCalled()
    expect(clipboard.paste).not.toHaveBeenCalled()
  })

  it('does not fire when the modifier click is not on a detected link', () => {
    const { onLinkClick, setLinkMenu, clipboard, suppressCalls } = makeHandler()
    // col 30 → x≈300, past all URL/path matches on the mocked line: detection returns null.
    onLinkClick(click({ ctrlKey: true, button: 0, clientX: 300, clientY: 6 }))

    expect(setLinkMenu).not.toHaveBeenCalled()
    expect(clipboard.paste).not.toHaveBeenCalled()
    // Important: onLinkClick never arms the paste-fallback suppression window — only onContextMenu
    // does (otherwise a modifier click in the middle of a session could swallow a later paste).
    expect(suppressCalls()).toBe(0)
  })

  it('suppresses xterm + browser defaults on a link hit (prevents selecting into the link)', () => {
    const { onLinkClick } = makeHandler()
    const e = click({ ctrlKey: true, button: 0, clientX: 60, clientY: 6 })

    onLinkClick(e)

    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.stopPropagation).toHaveBeenCalled()
    expect(e.stopImmediatePropagation).toHaveBeenCalled()
  })
})

/** A pane line naming a file the way an agent reports it: the path spans cols 6..22. */
const pathLine = {
  buffer: {
    active: {
      viewportY: 0,
      getLine: () => ({ translateToString: () => 'wrote src/app/main.ts:12:5 ok' }),
    },
  },
} as unknown as Partial<Terminal>

describe('createTerminalContextMenu — a file path in the output', () => {
  it('opens a modifier-clicked path straight away, with the line and column printed after it', () => {
    const openPath = vi.fn()
    const { onLinkClick, setLinkMenu } = makeHandler({ term: pathLine, openPath })

    onLinkClick(click({ ctrlKey: true, button: 0, clientX: 80, clientY: 6 }))

    expect(openPath).toHaveBeenCalledWith(expect.objectContaining({ text: 'src/app/main.ts', line: 12, col: 5 }))
    expect(setLinkMenu).not.toHaveBeenCalled()
  })

  it('shows the menu for a path when the pane cannot open it (a remote pane)', () => {
    const { onLinkClick, setLinkMenu } = makeHandler({ term: pathLine })

    onLinkClick(click({ ctrlKey: true, button: 0, clientX: 80, clientY: 6 }))

    expect(setLinkMenu).toHaveBeenCalledWith(expect.objectContaining({ kind: 'path', text: 'src/app/main.ts', line: 12 }))
  })

  it('lets a plain click on a path through to xterm, so an agent\'s click-to-select menu still gets it', () => {
    const openPath = vi.fn()
    const { onLinkClick, setLinkMenu } = makeHandler({ term: pathLine, openPath })
    const e = click({ button: 0, clientX: 80, clientY: 6 })

    onLinkClick(e)

    expect(openPath).not.toHaveBeenCalled()
    expect(setLinkMenu).not.toHaveBeenCalled()
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.stopPropagation).not.toHaveBeenCalled()
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled()
  })

  it('keeps a URL on the menu even when paths open straight away', () => {
    const openPath = vi.fn()
    const { onLinkClick, setLinkMenu } = makeHandler({ openPath })

    onLinkClick(click({ ctrlKey: true, button: 0, clientX: 60, clientY: 6 }))

    expect(openPath).not.toHaveBeenCalled()
    expect(setLinkMenu).toHaveBeenCalledWith(expect.objectContaining({ kind: 'url' }))
  })
})

describe('createTerminalContextMenu — onContextMenu (paste-fallback)', () => {
  // Regression: right-clicking a file an agent reported did nothing but paste.
  it('shows the link menu, with Paste, when a URL or path sits beneath the right-click', () => {
    const { onContextMenu, setLinkMenu, clipboard, term, suppressCalls } = makeHandler({ term: pathLine })

    onContextMenu(click({ clientX: 80, clientY: 6 }))

    expect(setLinkMenu).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'path', text: 'src/app/main.ts', line: 12, col: 5, fromContextMenu: true }),
    )
    expect(term.focus).toHaveBeenCalled()
    expect(clipboard.paste).not.toHaveBeenCalled()
    // The gesture's own native paste is held back; the menu's Paste item is the way to paste.
    expect(suppressCalls()).toBe(1)
  })

  it('copies selection when the right-click has a selection (no link detection runs)', () => {
    const clipboard = { copySelection: vi.fn(), paste: vi.fn() }
    const { onContextMenu, setLinkMenu } = makeHandler({
      clipboard,
      term: { hasSelection: () => true } as Partial<Terminal>,
    })

    // Click anywhere — selection does not depend on detection since the link path is gone.
    onContextMenu(click({ clientX: 300, clientY: 6 }))

    expect(setLinkMenu).not.toHaveBeenCalled()
    expect(clipboard.copySelection).toHaveBeenCalled()
    expect(clipboard.paste).not.toHaveBeenCalled()
  })

  it('pastes when the right-click is outside the grid (termEl ref irrelevant to paste-fallback)', () => {
    // The off-target rect is no longer meaningful for onContextMenu — paste is the only branch.
    const termEl = document.createElement('div')
    Object.defineProperty(termEl, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 100, width: 800, height: 480, right: 900, bottom: 580, x: 100, y: 100, toJSON: () => '' }),
    })
    const { onContextMenu, setLinkMenu, clipboard, term } = makeHandler({ termEl })

    onContextMenu(click({ clientX: 200, clientY: 50 }))

    expect(setLinkMenu).not.toHaveBeenCalled()
    expect(term.focus).toHaveBeenCalled()
    expect(clipboard.paste).toHaveBeenCalled()
  })

  it('calls preventDefault / stopPropagation so the browser context menu never opens', () => {
    const { onContextMenu } = makeHandler()
    const e = click({ clientX: 700, clientY: 6 })

    onContextMenu(e)

    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.stopPropagation).toHaveBeenCalled()
    expect(e.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('arms the native-paste suppression window only on paste, not on copy', () => {
    const suppressCopy = vi.fn()
    const suppressPaste = vi.fn()
    const { onContextMenu: onCopyClick } = makeHandler({
      clipboard: { copySelection: vi.fn(), paste: vi.fn() },
      term: { hasSelection: () => true } as Partial<Terminal>,
      setSuppressPaste: suppressCopy,
    })
    const { onContextMenu: onPasteClick } = makeHandler({
      clipboard: { copySelection: vi.fn(), paste: vi.fn() },
      term: { hasSelection: () => false } as Partial<Terminal>,
      setSuppressPaste: suppressPaste,
    })

    onCopyClick(click({ clientX: 200, clientY: 6 }))
    expect(suppressCopy).not.toHaveBeenCalled()

    onPasteClick(click({ clientX: 700, clientY: 6 }))
    expect(suppressPaste).toHaveBeenCalledOnce()
  })
})

describe('createTerminalContextMenu — OSC 8 hyperlinks', () => {
  // An agent prints `[a.ts](file:///D:/w/a.ts)` as the label `a.ts`: only xterm knows the target.
  it('opens a modifier-clicked file link in the editor, with its line and column', () => {
    const openPath = vi.fn()
    const { linkHandler, setLinkMenu } = makeHandler({ openPath })
    expect(linkHandler.allowNonHttpProtocols).toBe(true)
    linkHandler.activate(click({ ctrlKey: true, clientX: 5, clientY: 6 }), 'file:///D:/w/a%20b.ts:12:5', { start: { x: 1, y: 1 }, end: { x: 4, y: 1 } })
    expect(openPath).toHaveBeenCalledWith(expect.objectContaining({ kind: 'path', text: 'D:/w/a b.ts', line: 12, col: 5 }))
    expect(setLinkMenu).not.toHaveBeenCalled()
  })

  it('shows the URL menu for a web link and ignores a click without the modifier or another scheme', () => {
    const { linkHandler, setLinkMenu } = makeHandler()
    const range = { start: { x: 1, y: 1 }, end: { x: 4, y: 1 } }
    linkHandler.activate(click({ ctrlKey: false }), 'https://example.test/docs', range)
    linkHandler.activate(click({ ctrlKey: true }), 'javascript:alert(1)', range)
    linkHandler.activate(click({ ctrlKey: true }), 'file://server/share/a.ts', range)
    expect(setLinkMenu).not.toHaveBeenCalled()
    linkHandler.activate(click({ ctrlKey: true, clientX: 7, clientY: 8 }), 'https://example.test/docs', range)
    expect(setLinkMenu).toHaveBeenCalledWith({ x: 7, y: 8, kind: 'url', text: 'https://example.test/docs' })
  })

  it('without an editor, offers a file link in the Copy/Open menu', () => {
    const { linkHandler, setLinkMenu } = makeHandler()
    linkHandler.activate(click({ ctrlKey: true, clientX: 1, clientY: 2 }), 'file:///home/me/a.ts', { start: { x: 1, y: 1 }, end: { x: 4, y: 1 } })
    expect(setLinkMenu).toHaveBeenCalledWith({ x: 1, y: 2, kind: 'path', text: '/home/me/a.ts' })
  })
})
