/**
 * @vitest-environment jsdom
 */
import type { ILinkProvider, Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import {
  continuationSpan,
  findLinkOrPathAt,
  findLinkOrPathInTerminal,
  isTerminalLinkModifierClick,
  joinedPathCandidates,
  linkSpansOnLine,
  oscLinkTarget,
  registerPlainTextLinks,
  safeHttpUrl,
} from '../terminalLinks'

describe('terminalLinks', () => {
  it('accepts only credential-free HTTP(S) URLs', () => {
    expect(safeHttpUrl('https://example.test/path')?.protocol).toBe('https:')
    expect(safeHttpUrl('file:///tmp/secret')).toBeNull()
    expect(safeHttpUrl('https://user:pass@example.test')).toBeNull()
    expect(safeHttpUrl('https://example.test/has space')).toBeNull()
  })

  it('isTerminalLinkModifierClick returns true only when the platform modifier is held', () => {
    // jsdom defaults to a non-Mac platform, so Ctrl is the link-modifier key here.
    expect(isTerminalLinkModifierClick(new MouseEvent('click', { ctrlKey: true }))).toBe(true)
    expect(isTerminalLinkModifierClick(new MouseEvent('click', { ctrlKey: false, metaKey: true }))).toBe(false)

    // A Mac platform would flip the rule: Cmd matches, Ctrl does not.
    const originalPlatform = navigator.platform
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
    try {
      expect(isTerminalLinkModifierClick(new MouseEvent('click', { metaKey: true }))).toBe(true)
      expect(isTerminalLinkModifierClick(new MouseEvent('click', { ctrlKey: true }))).toBe(false)
    } finally {
      Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true })
    }
  })

  it('linkifies plain URLs and trims sentence punctuation', () => {
    let provider: ILinkProvider | undefined
    const terminal = {
      buffer: { active: { getLine: vi.fn(() => ({ translateToString: () => 'See https://example.test/docs).' })) } },
      registerLinkProvider: vi.fn((next: ILinkProvider) => {
        provider = next
        return { dispose: vi.fn() }
      }),
    } as unknown as Terminal

    registerPlainTextLinks(terminal)
    const callback = vi.fn()
    provider?.provideLinks(1, callback)

    expect(callback).toHaveBeenCalledWith([expect.objectContaining({
      text: 'https://example.test/docs',
      range: { start: { x: 5, y: 1 }, end: { x: 29, y: 1 } },
    })])
  })
})

describe('findLinkOrPathAt', () => {
  const URL_LINE = 'see https://example.test/path?q=1 for details'
  const POSIX_LINE = 'edit /home/me/code/lib.rs for the rule'
  const REL_LINE = 'check utils/lib.rs for the helper'
  const DRIVE_LINE = 'log at C:\\projects\\app\\log.txt is here'

  it('detects the URL kind when the cursor sits on a URL span', () => {
    expect(findLinkOrPathAt(URL_LINE, 4)?.kind).toBe('url')
    expect(findLinkOrPathAt(URL_LINE, 4)?.text).toBe('https://example.test/path?q=1')
    expect(findLinkOrPathAt(URL_LINE, 30)?.kind).toBe('url')
  })

  it('trims sentence punctuation off a URL span', () => {
    const match = findLinkOrPathAt('see https://example.test/path).', 5)
    expect(match?.kind).toBe('url')
    expect(match?.text).toBe('https://example.test/path')
  })

  it('returns null when the cursor misses every span on the line', () => {
    expect(findLinkOrPathAt(URL_LINE, 0)).toBeNull()
    expect(findLinkOrPathAt(URL_LINE, 50)).toBeNull()
    expect(findLinkOrPathAt('plain text here', 3)).toBeNull()
    expect(findLinkOrPathAt('', 0)).toBeNull()
  })

  it('detects POSIX absolute file paths', () => {
    const match = findLinkOrPathAt(POSIX_LINE, 5)
    expect(match?.kind).toBe('path')
    expect(match?.text).toBe('/home/me/code/lib.rs')
  })

  it('detects relative two-segment file paths', () => {
    const match = findLinkOrPathAt(REL_LINE, 10)
    expect(match?.kind).toBe('path')
    expect(match?.text).toBe('utils/lib.rs')
  })

  it('detects Windows drive paths', () => {
    const match = findLinkOrPathAt(DRIVE_LINE, 19) // col 19 is inside "log.txt"
    expect(match?.kind).toBe('path')
    expect(match?.text).toBe('C:\\projects\\app\\log.txt')
  })

  it('reads the line and column printed after a path, keeping them out of the path text', () => {
    expect(findLinkOrPathAt('see src/a.ts:12:5 now', 6)).toMatchObject({ text: 'src/a.ts', line: 12, col: 5 })
    expect(findLinkOrPathAt('at src/a.ts(7,2)', 4)).toMatchObject({ text: 'src/a.ts', line: 7, col: 2 })
    expect(findLinkOrPathAt('see src/a.ts:12.', 6)).toMatchObject({ text: 'src/a.ts', line: 12 })
    const plain = findLinkOrPathAt('wrote .bizreq/outbox/56069-decision-task.md', 8)
    expect(plain?.text).toBe('.bizreq/outbox/56069-decision-task.md')
    expect(plain?.line).toBeUndefined()
  })

  it('keeps a folder name with spaces inside one path', () => {
    const line = 'Report 56159: test/test-results/runs/Sprint 254/56159-migration-hours-overview/latest.html'
    const whole = 'test/test-results/runs/Sprint 254/56159-migration-hours-overview/latest.html'
    expect(findLinkOrPathAt(line, line.indexOf('Sprint'))?.text).toBe(whole)
    expect(findLinkOrPathAt(line, line.indexOf('254/'))?.text).toBe(whole)
    expect(findLinkOrPathAt(line, line.indexOf('latest'))?.text).toBe(whole)
    expect(findLinkOrPathAt('open C:\\My Documents\\a.txt', 8)?.text).toBe('C:\\My Documents\\a.txt')
    expect(findLinkOrPathAt('open ./My Files/a.txt', 8)?.text).toBe('./My Files/a.txt')
  })

  it('does not join two paths, or a path and a word, across a space', () => {
    const line = 'edited src/a.ts and src/b.ts'
    expect(linkSpansOnLine(line).map((span) => span.text)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(linkSpansOnLine('see Docs src/a.ts').map((span) => span.text)).toEqual(['src/a.ts'])
    expect(linkSpansOnLine('runs/Sprint 254 done').map((span) => span.text)).toEqual(['runs/Sprint'])
  })

  it('joins a path only with the word across the line break it touches', () => {
    const span = linkSpansOnLine('see src/a.ts:12')[0]!
    expect(joinedPathCandidates(span, 'see src/a.ts:12', 'before', 'More text')).toEqual(['src/a.ts More', 'src/a.tsMore'])
    const opening = linkSpansOnLine('  src/a.ts then')[0]!
    expect(joinedPathCandidates(opening, '  src/a.ts then', 'see the', null)).toEqual(['the src/a.ts', 'thesrc/a.ts'])
    const inside = linkSpansOnLine('see src/a.ts then')[0]!
    expect(joinedPathCandidates(inside, 'see src/a.ts then', 'x', 'y')).toEqual([])
  })

  // Regression: `spdd/reviews/56070-202611221515-[Handoff]-x.md` stopped at the `[`.
  it('keeps square brackets inside a file name, but not a bracket around the path', () => {
    const path = 'spdd/reviews/56070-202611221515-[Handoff]-service-delivery-tc02-tc03.md'
    expect(linkSpansOnLine(`Wrote ${path}.`).map((span) => span.text)).toEqual([path])
    expect(linkSpansOnLine(`(${path})`).map((span) => span.text)).toEqual([path])
    expect(linkSpansOnLine('[see src/a.ts]').map((span) => span.text)).toEqual(['src/a.ts'])
    expect(linkSpansOnLine('[a](src/a.ts) and docs/[x].md]').map((span) => span.text)).toEqual(['src/a.ts', 'docs/[x].md'])
  })

  it('reads a file name opening a line as the end of the path the line before broke off', () => {
    const before = 'Review: spdd/reviews/56070-202611221515-'
    expect(continuationSpan('[Handoff]-service-delivery-tc02-tc03.md', before)).toMatchObject({
      kind: 'path',
      text: '[Handoff]-service-delivery-tc02-tc03.md',
      start: 0,
      candidates: [
        'spdd/reviews/56070-202611221515-[Handoff]-service-delivery-tc02-tc03.md',
        'spdd/reviews/56070-202611221515- [Handoff]-service-delivery-tc02-tc03.md',
      ],
    })
    expect(continuationSpan('  latest.html done', 'see test/runs/Sprint')?.candidates).toEqual([
      'test/runs/Sprint latest.html',
      'test/runs/Sprintlatest.html',
    ])
    // Prose after a path, a path that does not close its line, or no path at all: no link.
    expect(continuationSpan('and then more', 'edited src/a.ts')).toBeNull()
    expect(continuationSpan('notes.md', 'edited src/a.ts today')).toBeNull()
    expect(continuationSpan('notes.md', 'nothing here')).toBeNull()
    expect(continuationSpan('src/b.ts', 'edited src/a.ts')).toBeNull()
  })

  it('does NOT match a bare filename with no path separator', () => {
    // `changelog.md` reads as a project file only WITH a separator — without one, it is just a word.
    expect(findLinkOrPathAt('the changelog changelog.md is updated', 18)).toBeNull()
  })

  it('passes URL and path detection independently when both are on the same line', () => {
    const line = 'cat src/foo.rs ; open https://example.test/docs'
    const urlCol = line.indexOf('https')

    const pathMatch = findLinkOrPathAt(line, 4)
    expect(pathMatch?.kind).toBe('path')
    expect(pathMatch?.text).toBe('src/foo.rs')

    const urlMatch = findLinkOrPathAt(line, urlCol)
    expect(urlMatch?.kind).toBe('url')
    expect(urlMatch?.text).toBe('https://example.test/docs')
  })

  it('does not let a path regex slip catch the URL scheme slice (looks-behind guard)', () => {
    // The drive alternative clamps on `[A-Za-z]:` — `file:///...` could otherwise be read as
    // `e:/...` (the `e:` slice of `file:`). The look-behind denies a letter before the drive letter,
    // and POSIX alt requires a non-slash char immediately after the leading `/`, so a `///` noise
    // run from a `file://` URL must NOT be folded into the matched path.
    const line = 'see file:///etc/secrets.txt'
    // The third slash sits at the start of `/etc/secrets.txt` (col index 11). Right-clicking the
    // middle slash (col 10) is between `file:` and `/etc/…` — there is no path span there.
    expect(findLinkOrPathAt(line, 10)).toBeNull()

    const match = findLinkOrPathAt(line, 11)
    expect(match?.kind).toBe('path')
    if (match?.kind === 'path') {
      expect(match.text.startsWith('e:')).toBe(false)
      expect(match.text.startsWith('file:')).toBe(false)
      expect(match.text).toBe('/etc/secrets.txt')
    }
  })
})

describe('findLinkOrPathInTerminal', () => {
  /** 80×24 mocked xterm: cellWidth=10, cellHeight=20, view at top (viewportY=0). */
  function fakeTerminal(line: string) {
    return {
      cols: 80,
      rows: 24,
      buffer: {
        active: {
          viewportY: 0,
          getLine: vi.fn(() => ({ translateToString: () => line })),
        },
      },
    } as unknown as Terminal
  }

  function rectAt(left: number, top: number, w: number, h: number): HTMLElement {
    const el = document.createElement('div')
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top, toJSON: () => '',
      }),
    })
    return el
  }

  it('maps a click inside a URL cell to a url match', () => {
    const line = 'open https://example.test/x here'
    // 'open ' (cols 0-4); URL starts at col 5. At 10px/cell, col 5 ≈ pixel x=50.
    const match = findLinkOrPathInTerminal(fakeTerminal(line), rectAt(0, 0, 800, 480), 55, 5)
    expect(match?.kind).toBe('url')
    expect(match?.text).toBe('https://example.test/x')
  })

  it('accounts for viewportY when the user has scrolled away from the bottom', () => {
    const lines = ['some old scrollback line', 'open http://x.test/ here']
    const terminal = {
      cols: 40,
      rows: 2,
      buffer: {
        active: {
          viewportY: 5, // visible row 0 maps to buffer row 5
          getLine: vi.fn((y: number) => ({ translateToString: () => lines[y - 5] ?? '' })),
        },
      },
    } as unknown as Terminal
    // 40 cols × 10px = 400w; 2 rows × 20px = 40h.
    const termEl = rectAt(0, 0, 400, 40)

    // Click row 1 (top: 20 to 40) at column 6 (http://...) within line 'open http://x.test/ here'.
    const match = findLinkOrPathInTerminal(terminal, termEl, 65, 30)
    expect(terminal.buffer.active.getLine).toHaveBeenCalledWith(5 + 1)
    expect(match?.kind).toBe('url')
    expect(match?.text).toBe('http://x.test/')
  })

  it('returns null when the click lands outside the element rect', () => {
    const termEl = rectAt(100, 100, 800, 480)
    const terminal = {
      cols: 80,
      rows: 24,
      buffer: { active: { viewportY: 0, getLine: vi.fn() } },
    } as unknown as Terminal

    expect(findLinkOrPathInTerminal(terminal, termEl, 50, 100)).toBeNull() // left of rect
    expect(findLinkOrPathInTerminal(terminal, termEl, 100, 50)).toBeNull() // above rect
  })
})

describe('oscLinkTarget', () => {
  it('reads local file URIs as paths, with a trailing line and column', () => {
    expect(oscLinkTarget('file:///D:/work/a.ts')).toEqual({ kind: 'path', text: 'D:/work/a.ts' })
    expect(oscLinkTarget('file://localhost/home/me/a.ts:3')).toEqual({ kind: 'path', text: '/home/me/a.ts', line: 3 })
    expect(oscLinkTarget('file:///C:/My%20Docs/x.md:4:2')).toEqual({ kind: 'path', text: 'C:/My Docs/x.md', line: 4, col: 2 })
  })

  it('keeps HTTP(S) links and drops every other target', () => {
    expect(oscLinkTarget('https://example.test/a?b=1')).toEqual({ kind: 'url', text: 'https://example.test/a?b=1' })
    for (const uri of ['javascript:alert(1)', 'file://evil.host/share/a', 'not a uri', 'https://u:p@example.test/', 'file:///a%0Ab', 'file:///%E0%A4%A']) {
      expect(oscLinkTarget(uri), uri).toBeNull()
    }
  })
})
