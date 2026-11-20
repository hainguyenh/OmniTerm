/**
 * The tail of a pane's raw output kept for cross-restart scrollback. Output arrives in many small
 * pieces, so they are kept as a list and joined only when the list has grown to twice the limit
 * or the text is read: appending is constant-time instead of copying the whole (up to the limit)
 * string on every chunk, which a fast stream used to do once over the limit.
 */
export class ScrollbackBuffer {
  private chunks: string[] = []
  private size = 0

  constructor(private readonly limit: number) {}

  append(text: string): void {
    if (!text) return
    this.chunks.push(text)
    this.size += text.length
    if (this.size > this.limit * 2) this.compact()
  }

  /** Starts over from `text` (history restored from disk). */
  replace(text: string): void {
    this.chunks = text ? [text] : []
    this.size = text.length
    this.compact()
  }

  /** The kept text: at most `limit` characters, the newest ones. */
  text(): string {
    this.compact()
    return this.chunks[0] ?? ''
  }

  private compact(): void {
    if (this.chunks.length <= 1 && this.size <= this.limit) return
    const joined = this.chunks.join('')
    const kept = joined.length > this.limit ? joined.slice(-this.limit) : joined
    this.chunks = kept ? [kept] : []
    this.size = kept.length
  }
}

/** Output faster than this is written without smart colouring (see `OutputRate`). */
export const SMART_COLOR_MAX_CHARS_PER_SEC = 256 * 1024

/**
 * How much output arrived in the last second. Smart colouring runs a regex over every line, which
 * a flood (a build log, `cat` of a large file) cannot afford; above the rate the text is written
 * as it came, and colouring resumes once the stream slows down.
 */
export class OutputRate {
  private windowStart = 0
  private chars = 0

  constructor(private readonly maxPerSecond: number = SMART_COLOR_MAX_CHARS_PER_SEC) {}

  /** Counts `chars` arriving at `now`; true while the last second's output is over the limit. */
  flooding(chars: number, now: number): boolean {
    if (now - this.windowStart >= 1_000) {
      this.windowStart = now
      this.chars = 0
    }
    this.chars += chars
    return this.chars > this.maxPerSecond
  }
}
