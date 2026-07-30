/**
 * Client-side output highlighter (editor-style "syntax highlighting").
 *
 * Remote shells only color what they're configured to color (prompt, ls) —
 * ordinary command output arrives as plain text. This transformer colorizes
 * recognizable tokens (quoted strings, numbers, paths, IPs, URLs, error /
 * warning / success words) by injecting standard ANSI SGR codes, so the
 * active theme's palette decides the actual colors.
 *
 * Safety rules:
 *  - Only text currently rendered in the DEFAULT foreground color is touched —
 *    anything the server already colored (prompt, ls output) passes through.
 *  - Disabled while the alternate screen is active (vim, htop, less…) so
 *    full-screen apps keep their own styling.
 *  - Incomplete escape sequences at a chunk boundary are carried over to the
 *    next chunk, never split or rewritten mid-sequence.
 */

const TOKEN_RE = new RegExp(
  [
    /(?<url>\bhttps?:\/\/[^\s'"<>]+)/.source,
    /(?<quote>"[^"\n]*"|'[^'\n]*')/.source,
    /(?<err>\b(?:error(?:s)?|failed|failure|fatal|denied|refused|invalid|cannot|unable|unreachable|critical|panic|exception|not found|timed? ?out)\b)/.source,
    /(?<warn>\b(?:warning(?:s)?|warn|deprecated|missing|skipped)\b)/.source,
    /(?<ok>\b(?:success(?:ful(?:ly)?)?|completed|connected|established|started|enabled|ready|passed|online|active|running|done|ok)\b)/.source,
    /(?<ip>\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b)/.source,
    /(?<path>(?<=^|[\s'"=(:[])\/(?:[\w.@~+-]+\/)*[\w.@~+-]+\/?)/.source,
    /(?<num>\b\d+(?:\.\d+)*\b)/.source,
  ].join('|'),
  'gim',
)

// Token → SGR open/close. Close restores default fg (39) — never a full reset,
// so attributes the server set around us survive. URLs also toggle underline.
const STYLE: Record<string, [string, string]> = {
  url: ['\x1b[4;96m', '\x1b[24;39m'],
  quote: ['\x1b[33m', '\x1b[39m'],
  err: ['\x1b[91m', '\x1b[39m'],
  warn: ['\x1b[93m', '\x1b[39m'],
  ok: ['\x1b[92m', '\x1b[39m'],
  ip: ['\x1b[96m', '\x1b[39m'],
  path: ['\x1b[94m', '\x1b[39m'],
  num: ['\x1b[95m', '\x1b[39m'],
}

const colorize = (text: string): string =>
  text.replace(TOKEN_RE, (match, ...args) => {
    const groups = args[args.length - 1] as Record<string, string | undefined>
    for (const key in STYLE) {
      if (groups[key] !== undefined) {
        const [open, close] = STYLE[key]
        return open + match + close
      }
    }
    return match
  })

// Don't buffer unterminated sequences forever (e.g. binary garbage) — flush raw.
const MAX_CARRY = 1024

export class OutputHighlighter {
  private carry = ''           // incomplete escape sequence held until next chunk
  private fgColored = false    // server set a non-default foreground
  private altScreen = false    // vim/htop/less etc. own the screen
  private enabled = true

  /**
   * Pass every chunk through even when disabled — the sequence parser keeps
   * fg/alt-screen state in sync so re-enabling mid-session stays correct.
   */
  transform(input: string, enabled = true): string {
    this.enabled = enabled
    const text = this.carry + input
    this.carry = ''
    let out = ''
    let i = 0

    while (i < text.length) {
      const esc = text.indexOf('\x1b', i)
      if (esc === -1) {
        out += this.plain(text.slice(i))
        break
      }
      out += this.plain(text.slice(i, esc))

      const seqLen = this.measureSequence(text, esc)
      if (seqLen === -1) {
        // Incomplete sequence at the chunk edge — hold it (bounded).
        const rest = text.slice(esc)
        if (rest.length <= MAX_CARRY) this.carry = rest
        else out += rest
        break
      }
      const seq = text.slice(esc, esc + seqLen)
      this.updateState(seq)
      out += seq
      i = esc + seqLen
    }
    return out
  }

  /** Highlight only default-colored, main-screen text. */
  private plain(segment: string): string {
    if (!segment || !this.enabled || this.altScreen || this.fgColored) return segment
    return colorize(segment)
  }

  /** Length of the escape sequence starting at `start`, or -1 if incomplete. */
  private measureSequence(text: string, start: number): number {
    if (start + 1 >= text.length) return -1
    const kind = text[start + 1]

    if (kind === '[') {
      // CSI: ESC [ params(0x30-0x3F) intermediates(0x20-0x2F) final(0x40-0x7E)
      for (let i = start + 2; i < text.length; i++) {
        const c = text.charCodeAt(i)
        if (c >= 0x40 && c <= 0x7e) return i - start + 1
        if (c < 0x20 || c > 0x3f) return i - start + 1 // malformed — stop consuming
      }
      return -1
    }
    if (kind === ']' || kind === 'P' || kind === 'X' || kind === '^' || kind === '_') {
      // OSC / DCS / SOS / PM / APC: terminated by BEL or ST (ESC \)
      for (let i = start + 2; i < text.length; i++) {
        if (text[i] === '\x07') return i - start + 1
        if (text[i] === '\x1b' && text[i + 1] === '\\') return i - start + 2
        if (text[i] === '\x1b' && i + 1 >= text.length) return -1
      }
      return -1
    }
    // Two-character sequence (ESC 7, ESC 8, ESC =, ESC M, …)
    return 2
  }

  private updateState(seq: string): void {
    // SGR — track whether a non-default foreground is active.
    if (seq.startsWith('\x1b[') && seq.endsWith('m') && !seq.includes('?')) {
      const params = seq.slice(2, -1).split(';')
      for (let i = 0; i < params.length; i++) {
        const p = parseInt(params[i] || '0', 10)
        if (p === 0 || p === 39) this.fgColored = false
        else if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) this.fgColored = true
        else if (p === 38) {
          this.fgColored = true
          i += params[i + 1] === '5' ? 2 : params[i + 1] === '2' ? 4 : 0 // skip color args
        }
      }
      return
    }
    // Alternate screen buffer on/off (vim, htop, less…).
    const alt = /^\x1b\[\?(?:1049|1047|47)(h|l)$/.exec(seq)
    if (alt) this.altScreen = alt[1] === 'h'
  }
}
