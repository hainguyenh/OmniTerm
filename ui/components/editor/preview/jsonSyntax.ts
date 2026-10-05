/**
 * Offset of the first JSON syntax error in `text`, or null if it is valid JSON.
 *
 * Only run after `JSON.parse` has already failed, to point the user at the problem: V8's message
 * gives a position only for longer inputs (a short document is quoted whole instead), so the location
 * cannot be read back from the error. Iterative — a bracket stack, no recursion — so deeply nested
 * input cannot overflow.
 */

type Expect = 'value' | 'valueOrClose' | 'keyOrClose' | 'key' | 'colon' | 'commaOrClose' | 'end'

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const LITERALS = ['true', 'false', 'null']

/** End index (exclusive) of the string starting at `start`, or the offset where it breaks. */
function scanString(text: string, start: number): { end: number } | { error: number } {
  for (let i = start + 1; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code === 34) return { end: i + 1 }
    if (code < 0x20) return { error: i }
    if (code === 92) {
      const next = text[i + 1]
      if (next === 'u') {
        if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) return { error: i }
        i += 5
      } else if (next !== undefined && '"\\/bfnrt'.includes(next)) {
        i += 1
      } else {
        return { error: i }
      }
    }
  }
  return { error: text.length }
}

export function jsonErrorOffset(text: string): number | null {
  const stack: string[] = []
  let expect: Expect = 'value'
  let i = 0
  // What follows a complete value: more of the enclosing container, or nothing at the top level.
  const afterValue = (): Expect => (stack.length > 0 ? 'commaOrClose' : 'end')

  while (true) {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i += 1
    if (i >= text.length) return expect === 'end' ? null : text.length
    const c = text[i]

    if (expect === 'end') return i
    if (expect === 'colon') {
      if (c !== ':') return i
      expect = 'value'
      i += 1
      continue
    }
    if (expect === 'commaOrClose') {
      const top = stack[stack.length - 1]
      if (c === ',') {
        expect = top === '{' ? 'key' : 'value'
        i += 1
      } else if ((c === '}' && top === '{') || (c === ']' && top === '[')) {
        stack.pop()
        i += 1
        expect = afterValue()
      } else {
        return i
      }
      continue
    }
    if ((expect === 'keyOrClose' && c === '}') || (expect === 'valueOrClose' && c === ']')) {
      stack.pop()
      i += 1
      expect = afterValue()
      continue
    }
    if (expect === 'keyOrClose' || expect === 'key') {
      if (c !== '"') return i
      const scanned = scanString(text, i)
      if ('error' in scanned) return scanned.error
      i = scanned.end
      expect = 'colon'
      continue
    }

    // A value.
    if (c === '{' || c === '[') {
      stack.push(c)
      expect = c === '{' ? 'keyOrClose' : 'valueOrClose'
      i += 1
      continue
    }
    if (c === '"') {
      const scanned = scanString(text, i)
      if ('error' in scanned) return scanned.error
      i = scanned.end
      expect = afterValue()
      continue
    }
    NUMBER.lastIndex = i
    const number = NUMBER.exec(text)
    if (number) {
      i += number[0].length
      expect = afterValue()
      continue
    }
    const literal = LITERALS.find((word) => text.startsWith(word, i))
    if (!literal) return i
    i += literal.length
    expect = afterValue()
  }
}
