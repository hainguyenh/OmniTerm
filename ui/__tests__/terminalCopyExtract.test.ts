/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import {
  createLastOutputTracker,
  dispatchTerminalCopy,
  parseTerminalCopyEvent,
  viewportText,
  TERMINAL_COPY_EVENT,
  type TerminalBufferLike,
} from '../utils/terminalCopyExtract'

const makeBuffer = (lines: string[], viewportY: number): TerminalBufferLike => ({
  active: {
    length: lines.length,
    viewportY,
    getLine: (i) =>
      i >= 0 && i < lines.length ? { translateToString: () => lines[i] } : undefined,
  },
})

/** A buffer whose line list is read live, so appends/clears model PTY output arriving. */
const liveBuffer = (lines: string[]): TerminalBufferLike => ({
  active: {
    get length() { return lines.length },
    get viewportY() { return 0 },
    getLine: (i) => {
      const current = lines
      return i >= 0 && i < current.length ? { translateToString: () => current[i] } : undefined
    },
  },
})

describe('viewportText', () => {
  it('copies only the rows the viewport shows', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`)
    expect(viewportText(makeBuffer(lines, 5), 3)).toBe('line-5\nline-6\nline-7')
  })

  it('trims trailing blank lines', () => {
    const lines = ['a', '', 'b', '', '', '']
    expect(viewportText(makeBuffer(lines, 0), 6)).toBe('a\n\nb')
  })

  it('returns empty when the viewport shows nothing but blanks', () => {
    expect(viewportText(makeBuffer(['', ''], 0), 2)).toBe('')
  })

  it('clamps when rows extend past the end of the buffer', () => {
    // Real xterm keeps enough lines to fill the viewport; a shrunk/stale buffer just yields less.
    expect(viewportText(makeBuffer(['only'], 0), 30)).toBe('only')
    expect(viewportText(makeBuffer([], 5), 3)).toBe('')
  })
})

describe('createLastOutputTracker', () => {
  it('returns empty before any Enter', () => {
    const tracker = createLastOutputTracker(makeBuffer(['$ ls'], 0))
    expect(tracker.lastOutputText()).toBe('')
  })

  it('captures the prompt line plus everything printed after Enter', () => {
    const lines = ['$ ls']
    const tracker = createLastOutputTracker(liveBuffer(lines))
    tracker.noteInput('\r')
    lines.push('file-a', 'file-b')
    expect(tracker.lastOutputText()).toBe('$ ls\nfile-a\nfile-b')
  })

  it('moves the marker forward on the next Enter', () => {
    const lines = ['one']
    const tracker = createLastOutputTracker(liveBuffer(lines))
    tracker.noteInput('\r')
    lines.push('two')
    tracker.noteInput('\r')
    lines.push('three')
    // Marker sits on the newest prompt-style line ("two"), so "one" drops out.
    expect(tracker.lastOutputText()).toBe('two\nthree')
  })

  it('ignores input without a carriage return', () => {
    const lines = ['$ ls']
    const tracker = createLastOutputTracker(liveBuffer(lines))
    tracker.noteInput('l')
    lines.push('later output')
    expect(tracker.lastOutputText()).toBe('')
  })

  it('yields nothing once the marked region was cleared, never reading stale lines', () => {
    const lines = ['a', 'b']
    const tracker = createLastOutputTracker(liveBuffer(lines))
    tracker.noteInput('\r')
    expect(tracker.lastOutputText()).toBe('b')
    lines.length = 0
    lines.push('fresh')
    // The Enter's output region was wiped by the clear; the clamp must yield '', not leak lines.
    expect(tracker.lastOutputText()).toBe('')
  })

  it('excludes the idle shell prompt the terminal printed after the command finished', () => {
    // Real sequence: Enter echoes "PS F:\repo> rtk stats", output streams in, the shell then
    // prints a fresh idle prompt. That trailing prompt is shell chrome, not output.
    const lines = ['PS F:\\my-repos\\agentic\\engram> rtk stats']
    const tracker = createLastOutputTracker(liveBuffer(lines))
    tracker.noteInput('\r')
    lines.push(
      'Total exec time: 3316m32s',
      'Efficiency meter: ██████████░░ 85.1%',
      'PS F:\\my-repos\\agentic\\engram>',
    )
    expect(tracker.lastOutputText()).toBe(
      'PS F:\\my-repos\\agentic\\engram> rtk stats\nTotal exec time: 3316m32s\nEfficiency meter: ██████████░░ 85.1%',
    )
  })

  it('excludes cmd-style drive-path prompts and blank gaps before them', () => {
    const lines = ['F:\\repo> build.cmd']
    const tracker = createLastOutputTracker(liveBuffer(lines))
    tracker.noteInput('\r')
    lines.push('compiled ok', '', 'F:\\repo>')
    expect(tracker.lastOutputText()).toBe('F:\\repo> build.cmd\ncompiled ok')
  })

  it('keeps the echoed command line even when the command produced no output', () => {
    const lines = ['PS F:\\repo>']
    const tracker = createLastOutputTracker(liveBuffer(lines))
    tracker.noteInput('\r')
    lines.push('PS F:\\repo>')
    expect(tracker.lastOutputText()).toBe('PS F:\\repo>')
  })

  it('does not strip ordinary output that merely contains > or looks table-like', () => {
    const lines = ['$ tail -n2 log']
    const tracker = createLastOutputTracker(liveBuffer(lines))
    tracker.noteInput('\r')
    lines.push('  -> step 2 done', 'path > other/path')
    expect(tracker.lastOutputText()).toBe('$ tail -n2 log\n  -> step 2 done\npath > other/path')
  })
})

describe('event helpers', () => {
  it('round-trips a copy request through a window event', () => {
    const seen: unknown[] = []
    const listener = (e: Event) => seen.push(parseTerminalCopyEvent(e))
    window.addEventListener(TERMINAL_COPY_EVENT, listener)
    dispatchTerminalCopy('session-1', 'last-output')
    window.removeEventListener(TERMINAL_COPY_EVENT, listener)
    expect(seen).toEqual([{ sessionId: 'session-1', action: 'last-output' }])
  })

  it('rejects malformed payloads instead of trusting them', () => {
    const event = new CustomEvent(TERMINAL_COPY_EVENT, { detail: { sessionId: 'other-session', action: 42 } })
    expect(parseTerminalCopyEvent(event)).toBeNull()
    expect(parseTerminalCopyEvent(new Event('resize'))).toBeNull()
  })
})
