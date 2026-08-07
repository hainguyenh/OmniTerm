/**
 * Split terminal output into pieces small enough for xterm to parse without blocking a frame.
 *
 * xterm's own `WriteBuffer` already queues successive `write()` calls and yields to the renderer
 * between them — but it cannot yield *inside* one call, because a single chunk is parsed atomically.
 * So a 256 KiB scrollback replay handed over as one `write()` is one uninterruptible parse, which is
 * what froze the app when a pane attached (pop-out and fold-back both replay the whole buffer).
 * Handing the same bytes over as N calls lets xterm interleave parsing with painting, and the pane
 * fills in progressively instead of hanging and then appearing.
 *
 * Splitting at an arbitrary offset is safe for xterm specifically: its escape-sequence parser is a
 * state machine that carries an unfinished sequence across `write()` calls. (The output highlighter
 * has no such luxury and does its own carry — see highlighter.ts.) The one split that is NOT safe is
 * between the halves of a surrogate pair, which would turn an astral character into two replacement
 * glyphs, so that case is stepped back over.
 */

/**
 * 16 KiB. Small enough that one chunk parses well inside a frame, large enough that a full replay is
 * a couple of dozen calls rather than thousands.
 */
export const WRITE_CHUNK_SIZE = 16 * 1024

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff

/**
 * `text` as one or more chunks of at most `size` UTF-16 code units. Text at or below the limit is
 * returned as a single chunk, so the common case of a live 4 KiB read allocates nothing extra.
 */
export const chunkForWrite = (text: string, size = WRITE_CHUNK_SIZE): string[] => {
  if (text.length <= size) return [text]

  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + size, text.length)
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}
