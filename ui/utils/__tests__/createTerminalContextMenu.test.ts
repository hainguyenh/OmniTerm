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
  const { onContextMenu, onLinkClick } = createTerminalContextMenu({
    term,
    termElRef,
    clipboard,
    setLinkMenu,
    setSuppressPaste: overrides.setSuppressPaste ?? suppress,
  })
  return {
    onContextMenu,
    onLinkClick,
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

describe('createTerminalContextMenu — onContextMenu (paste-fallback)', () => {
  it('never opens the link overlay, even when a URL sits beneath the right-click', () => {
    const { onContextMenu, setLinkMenu, clipboard, term } = makeHandler()
    // Client coords land exactly where the URL lives — pre-refactor this would have shown the menu.
    onContextMenu(click({ clientX: 60, clientY: 6 }))

    expect(setLinkMenu).not.toHaveBeenCalled()
    expect(term.focus).toHaveBeenCalled()
    // Selection absent (default fake) → paste branch is taken instead of copy.
    expect(clipboard.paste).toHaveBeenCalled()
    expect(clipboard.copySelection).not.toHaveBeenCalled()
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
