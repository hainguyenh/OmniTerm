import { describe, it, expect, vi } from "vitest";
import { OutputHighlighter } from "../highlighter";

describe("OutputHighlighter", () => {
  it("colorizes plain text tokens", () => {
    const h = new OutputHighlighter();
    const out = h.transform(
      "error: /var/log/server.log 192.168.1.1 http://example.com",
      true,
    );
    expect(out).toContain("\x1b[91m");
    expect(out).toContain("\x1b[94m");
    expect(out).toContain("\x1b[96m");
    expect(out).toContain("\x1b[4;96m");
  });

  it("ignores text while alternate screen is active", () => {
    const h = new OutputHighlighter();
    const altOn = h.transform("\x1b[?1049h", true);
    expect(altOn).not.toContain("\x1b[91m");
    const normal = h.transform("error", true);
    expect(normal).not.toContain("\x1b[91m");
    const altOff = h.transform("\x1b[?1049l", true);
    expect(altOff).toContain("\x1b[?1049l");
    expect(h.transform("error", true)).toContain("\x1b[91m");
  });

  it("does not colorize text already colored by the server", () => {
    const h = new OutputHighlighter();
    const colored = h.transform("\x1b[31mconnected\x1b[0m plain", true);
    expect(colored).toContain("\x1b[31m");
    expect(colored).toContain("plain");
  });

  it("carries incomplete escape sequences across chunks", () => {
    const h = new OutputHighlighter();
    const p1 = h.transform("plain \x1b[");
    expect(p1).toBe("plain ");
    const p2 = h.transform("31mred\x1b[0m");
    expect(p2).toContain("[31mred");
  });
});

describe('OutputHighlighter parser branches', () => {
  it('styles every remaining token class and leaves disabled text untouched', () => {
    const h = new OutputHighlighter()
    const raw = 'warning success "quoted" 12.3'
    expect(h.transform(raw, false)).toBe(raw)
    const out = h.transform(raw, true)
    expect(out).toContain('\x1b[93mwarning')
    expect(out).toContain('\x1b[92msuccess')
    expect(out).toContain('\x1b[33m"quoted"')
    expect(out).toContain('\x1b[95m12.3')
  })

  it('parses OSC-family terminators and ordinary two-byte escapes', () => {
    const h = new OutputHighlighter()
    for (const sequence of [
      '\x1b]0;title\x07',
      '\x1bPpayload\x1b\\',
      '\x1bXpayload\x07',
      '\x1b^payload\x07',
      '\x1b_payload\x07',
      '\x1b7',
    ]) {
      const out = h.transform(`${sequence} error`)
      expect(out).toContain(sequence)
      expect(out).toContain('\x1b[91merror')
    }
  })

  it('carries an ESC-only and string sequence boundary into the next chunk', () => {
    const h = new OutputHighlighter()
    expect(h.transform('\x1b')).toBe('')
    expect(h.transform('7 error')).toContain('\x1b7 \x1b[91merror')
    expect(h.transform('\x1b]unfinished\x1b')).toBe('')
    expect(h.transform('\\ success')).toContain('\x1b]unfinished\x1b\\ \x1b[92msuccess')
  })

  it('flushes oversized unterminated control strings instead of buffering forever', () => {
    const h = new OutputHighlighter()
    const garbage = `\x1b]${'x'.repeat(1025)}`
    expect(h.transform(garbage)).toBe(garbage)
    expect(h.transform('error')).toContain('\x1b[91merror')
  })

  it('stops malformed CSI sequences and resumes highlighting after them', () => {
    const h = new OutputHighlighter()
    const out = h.transform('\x1b[\x10 error')
    expect(out).toContain('\x1b[\x10')
    expect(out).toContain('\x1b[91merror')
  })

  it('tracks standard, indexed, and RGB foregrounds until reset', () => {
    const h = new OutputHighlighter()
    for (const color of ['\x1b[31m', '\x1b[91m', '\x1b[38;5;120m', '\x1b[38;2;1;2;3m']) {
      expect(h.transform(`${color}error`)).not.toContain('\x1b[91merror\x1b[39m')
      expect(h.transform('\x1b[39merror')).toContain('\x1b[91merror')
    }
    h.transform('\x1b[32m')
    expect(h.transform('\x1b[0merror')).toContain('\x1b[91merror')
  })

  it('recognizes every alternate-screen variant', () => {
    for (const code of ['47', '1047', '1049']) {
      const h = new OutputHighlighter()
      h.transform(`\x1b[?${code}h`)
      expect(h.transform('error')).toBe('error')
      h.transform(`\x1b[?${code}l`)
      expect(h.transform('error')).toContain('\x1b[91merror')
    }
  })

  // AI agent CLIs (Claude Code, Copilot CLI, Codex) repaint on the MAIN screen, so the alt-screen
  // rule above never fired for them and we were injecting SGR codes into the middle of their frames.
  describe('main-screen TUI suppression', () => {
    const TUI_SEQUENCES = [
      '\x1b[?2026h',   // begin synchronized update
      '\x1b[?2026l',   // end synchronized update
      '\x1b[?25l',     // hide cursor
      '\x1b[?1002h',   // mouse tracking
      '\x1b[2J',       // erase display
      '\x1b[3A',       // cursor up
      '\x1b[1B',       // cursor down
      '\x1b[12D',      // cursor back
      '\x1b[5;1H',     // absolute position beyond the first row
      '\x1b[8;20f',    // same, HVP form
    ]

    it.each(TUI_SEQUENCES)('passes text through untouched after %j', seq => {
      const h = new OutputHighlighter()
      expect(h.transform(seq)).toBe(seq)
      expect(h.transform('error: /var/log/x 42')).toBe('error: /var/log/x 42')
    })

    // A plain shell emits these when clearing, so they must not disable the feature.
    it.each(['\x1b[H', '\x1b[1;1H', '\x1b[1;40H'])('keeps colouring after home-only %j', seq => {
      const h = new OutputHighlighter()
      h.transform(seq)
      expect(h.transform('error')).toContain('\x1b[91merror')
    })

    it('resumes colouring once the TUI has been idle past the timeout', () => {
      vi.useFakeTimers()
      try {
        const h = new OutputHighlighter()
        h.transform('\x1b[?2026h')
        expect(h.transform('error')).toBe('error')
        // Still inside the window: a burst of redraws must not un-suppress between frames.
        vi.advanceTimersByTime(9_000)
        expect(h.transform('error')).toBe('error')
        // Past it: a one-off spinner shouldn't cost smart colours for the rest of the session.
        vi.advanceTimersByTime(2_000)
        expect(h.transform('error')).toContain('\x1b[91merror')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // A paste's echo is re-wrapped and repositioned by whatever is reading it. SGR codes injected into
  // that echo throw off its cell accounting, which is how a long paste came back overlapping — and the
  // TUI rule cannot cover it, because an idle agent emits no redraw sequence until after the first
  // echoed bytes.
  describe('local echo suppression', () => {
    it('stops colouring the echo of a paste, then resumes', () => {
      vi.useFakeTimers()
      try {
        const h = new OutputHighlighter()
        expect(h.transform('error')).toContain('\x1b[91merror')

        h.noteLocalEcho()
        expect(h.transform('error at /var/log/x')).toBe('error at /var/log/x')
        // Still inside the window: a large paste echoes over several chunks.
        vi.advanceTimersByTime(1_000)
        expect(h.transform('error')).toBe('error')

        vi.advanceTimersByTime(1_000)
        expect(h.transform('error')).toContain('\x1b[91merror')
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
