/**
 * Pane drag-and-drop reordering — issue #10.
 *
 * The bug was not in this logic: Tauri v2 defaults `dragDropEnabled` to true, which installs an
 * OS-level drop handler on the webview that consumes `dragover`/`drop` before the page sees them, so
 * dragging a pane header did nothing at all. The config assertions below are the regression guard
 * for that, because nothing else in the suite would notice the flag being dropped.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { draggedPaneIndex } from '../paneLayout'

describe('draggedPaneIndex', () => {
  it('reads the pane index a header drag put on the clipboard', () => {
    expect(draggedPaneIndex('0', 4)).toBe(0)
    expect(draggedPaneIndex('3', 4)).toBe(3)
  })

  it('ignores a drop that did not come from a pane header', () => {
    // `Number('')` is 0, not NaN, so parsing the payload directly turned every foreign drop — a
    // file, a text selection, a link — into "swap with pane 0". Disabling the webview's own
    // drag-drop handler is what lets those drops reach the page at all, so the guard has to exist.
    expect(draggedPaneIndex('', 4)).toBeNull()
    expect(draggedPaneIndex(String.raw`C:\Users\me\notes.txt`, 4)).toBeNull()
    expect(draggedPaneIndex('some selected text', 4)).toBeNull()
    expect(draggedPaneIndex(' 1 ', 4)).toBeNull()
    expect(draggedPaneIndex('1.5', 4)).toBeNull()
    expect(draggedPaneIndex('-1', 4)).toBeNull()
  })

  it('ignores an index outside the current layout', () => {
    // Panes 2 and 3 exist in state after a drop down from 4-up to 2-up; neither is on screen.
    expect(draggedPaneIndex('2', 2)).toBeNull()
    expect(draggedPaneIndex('4', 4)).toBeNull()
  })
})

describe('webview drag-drop configuration', () => {
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))

  it('leaves HTML5 drag-and-drop to the page on the main window', () => {
    const main = config.app.windows.find((w: { label: string }) => w.label === 'main')
    expect(main).toBeDefined()
    expect(main.dragDropEnabled).toBe(false)
  })

  it('disables the same handler on detached session windows', () => {
    // A detached window renders the same panes, so it needs the same answer. This lives here rather
    // than in the Rust tests because it is the same contract as the line above and should break in
    // the same place.
    const source = readFileSync('src-tauri/src/terminal_window.rs', 'utf8')
    expect(source).toContain('.disable_drag_drop_handler()')
  })
})
