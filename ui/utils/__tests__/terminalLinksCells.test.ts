/**
 * @vitest-environment jsdom
 */
import type { ILinkProvider, Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'

import { findLinkOrPathInTerminal, registerPlainTextLinks } from '../terminalLinks'

/** An xterm with real cells: `rows[i]` is drawn on row i; a `wrapped` row continues the one above. */
function cellTerminal(rows: Array<{ cells: Array<[string, number]>; wrapped?: boolean }>, cols = 40) {
  let provider: ILinkProvider | undefined
  const line = (row: (typeof rows)[number]) => ({
    isWrapped: !!row.wrapped,
    length: row.cells.length,
    getCell: (x: number) => {
      const cell = row.cells[x]
      return cell ? { getChars: () => cell[0], getWidth: () => cell[1] } : undefined
    },
    translateToString: () => row.cells.map((cell) => cell[0]).join(''),
  })
  const terminal = {
    cols,
    rows: rows.length,
    buffer: { active: { viewportY: 0, getLine: (y: number) => (rows[y] ? line(rows[y]) : undefined) } },
    registerLinkProvider: (next: ILinkProvider) => {
      provider = next
      return { dispose: () => {} }
    },
  } as unknown as Terminal
  return { terminal, links: (y: number) => new Promise<unknown>((resolve) => provider?.provideLinks(y, resolve)) }
}

/** Plain text as narrow cells, padded to `cols`. */
const narrow = (text: string, cols = 40): Array<[string, number]> =>
  [...text.padEnd(cols)].slice(0, cols).map((ch) => [ch, 1])

const grid = (cols: number, rows: number): HTMLElement => {
  const el = document.createElement('div')
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: cols * 10, height: rows * 20, right: cols * 10, bottom: rows * 20, x: 0, y: 0, toJSON: () => '' }),
  })
  return el
}

describe('cell-accurate link detection', () => {
  it('finds a path after wide characters, where string index and column differ', () => {
    // '✅' is one wide character: two cells, the second one empty with width 0.
    const cells: Array<[string, number]> = [['✅', 2], ['', 0], ...narrow(' wrote src/a.ts', 38)]
    const { terminal } = cellTerminal([{ cells }])
    // Column 10 is inside `src/a.ts` (cells 9..16); the string index there is 9.
    const match = findLinkOrPathInTerminal(terminal, grid(40, 1), 105, 5)
    expect(match).toMatchObject({ kind: 'path', text: 'src/a.ts' })
  })

  it('joins a path soft-wrapped onto the next row, from either half', () => {
    const path = 'D:\\workspace\\Bravo.AutomationPlaywright\\.bizreq\\outbox\\retro-56070-2026-11-22.md'
    const text = `Sau đó, bản nháp ${path} mới gửi`
    const { terminal } = cellTerminal([
      { cells: narrow(text.slice(0, 40)) },
      { cells: narrow(text.slice(40, 80)), wrapped: true },
      { cells: narrow(text.slice(80)), wrapped: true },
    ])
    for (const [x, y] of [[255, 5], [105, 25], [15, 45]]) {
      expect(findLinkOrPathInTerminal(terminal, grid(40, 3), x!, y!)).toMatchObject({ kind: 'path', text: path })
    }
  })

  // Regression: an agent wraps its own reply with hard line breaks, so `runs/Sprint 254/…` became
  // two links, `…/runs/Sprint` and `254/…`, and neither named a file.
  it('offers the path joined across a hard line break, from either half', () => {
    const { terminal } = cellTerminal([
      { cells: narrow('Report 56159: test/runs/Sprint') },
      { cells: narrow('  254/56159-overview/latest.html') },
    ])
    const joined = ['test/runs/Sprint 254/56159-overview/latest.html', 'test/runs/Sprint254/56159-overview/latest.html']
    expect(findLinkOrPathInTerminal(terminal, grid(40, 2), 255, 5)).toMatchObject({ text: 'test/runs/Sprint', candidates: joined })
    expect(findLinkOrPathInTerminal(terminal, grid(40, 2), 105, 25)).toMatchObject({
      text: '254/56159-overview/latest.html',
      candidates: joined,
    })
  })

  // Regression: an agent's reply broke a path before a name with no separator; the second half
  // was no link at all, and the first half alone named no file.
  it('links both halves of a path broken before its file name, and offers the joined path', async () => {
    const { terminal, links } = cellTerminal([
      { cells: narrow('Review: spdd/reviews/56070-202611221515-') },
      { cells: narrow('[Handoff]-service-delivery-tc02-tc03.md') },
    ])
    const joined = 'spdd/reviews/56070-202611221515-[Handoff]-service-delivery-tc02-tc03.md'
    expect(findLinkOrPathInTerminal(terminal, grid(40, 2), 105, 5)?.candidates).toContain(joined)
    expect(findLinkOrPathInTerminal(terminal, grid(40, 2), 105, 25)).toMatchObject({
      text: '[Handoff]-service-delivery-tc02-tc03.md',
      candidates: [joined, expect.any(String)],
    })
    registerPlainTextLinks(terminal)
    expect(await links(2)).toEqual([
      expect.objectContaining({ text: '[Handoff]-service-delivery-tc02-tc03.md', range: { start: { x: 1, y: 2 }, end: { x: 39, y: 2 } } }),
    ])
  })

  it('measures columns on the xterm screen, not on the wider pane around it', () => {
    const { terminal } = cellTerminal([{ cells: narrow('see src/a.ts here', 20) }], 20)
    const pane = grid(30, 1)
    const screen = grid(20, 1)
    screen.className = 'xterm-screen'
    pane.appendChild(screen)
    // x=45 is column 4 on the 200px screen; on the 300px pane it would read as column 3.
    expect(findLinkOrPathInTerminal(terminal, pane, 45, 5)).toMatchObject({ text: 'src/a.ts' })
  })

  it('underlines paths and URLs, with one range across wrapped rows', async () => {
    const text = 'open src/very/long/folder/name/file.ts and https://example.test/x'
    const { terminal, links } = cellTerminal([
      { cells: narrow(text.slice(0, 40)) },
      { cells: narrow(text.slice(40)), wrapped: true },
    ])
    registerPlainTextLinks(terminal)
    expect(await links(1)).toEqual([
      expect.objectContaining({
        text: 'src/very/long/folder/name/file.ts',
        range: { start: { x: 6, y: 1 }, end: { x: 38, y: 1 } },
        decorations: { underline: true, pointerCursor: true },
      }),
    ])
    expect(await links(2)).toEqual([
      expect.objectContaining({
        text: 'https://example.test/x',
        range: { start: { x: 4, y: 2 }, end: { x: 25, y: 2 } },
      }),
    ])
  })
})
