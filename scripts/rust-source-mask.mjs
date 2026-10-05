// Rust source helpers for the repository dead-code checks: offset-preserving masking of comments
// and literals, and brace matching over the masked text.

// Replace comments and string/character literals with spaces while preserving offsets. This keeps
// brace matching stable without mistaking documentation examples or format strings for Rust syntax.
export function maskRustNonCode(source) {
  const out = [...source]
  let index = 0
  let blockDepth = 0
  let state = 'code'
  let rawHashes = 0

  const blank = (at) => {
    if (out[at] !== '\n' && out[at] !== '\r') out[at] = ' '
  }

  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]

    if (state === 'line-comment') {
      blank(index)
      if (current === '\n') state = 'code'
      index += 1
      continue
    }
    if (state === 'block-comment') {
      blank(index)
      if (current === '/' && next === '*') {
        blank(index + 1)
        blockDepth += 1
        index += 2
      } else if (current === '*' && next === '/') {
        blank(index + 1)
        blockDepth -= 1
        index += 2
        if (blockDepth === 0) state = 'code'
      } else {
        index += 1
      }
      continue
    }
    if (state === 'string' || state === 'character') {
      blank(index)
      if (current === '\\') {
        blank(index + 1)
        index += 2
      } else if ((state === 'string' && current === '"') || (state === 'character' && current === "'")) {
        state = 'code'
        index += 1
      } else {
        index += 1
      }
      continue
    }
    if (state === 'raw-string') {
      blank(index)
      if (current === '"' && source.slice(index + 1, index + 1 + rawHashes) === '#'.repeat(rawHashes)) {
        for (let offset = 1; offset <= rawHashes; offset += 1) blank(index + offset)
        index += rawHashes + 1
        state = 'code'
      } else {
        index += 1
      }
      continue
    }

    if (current === '/' && next === '/') {
      blank(index)
      blank(index + 1)
      state = 'line-comment'
      index += 2
      continue
    }
    if (current === '/' && next === '*') {
      blank(index)
      blank(index + 1)
      state = 'block-comment'
      blockDepth = 1
      index += 2
      continue
    }
    if (current === '"') {
      blank(index)
      state = 'string'
      index += 1
      continue
    }
    if (current === "'") {
      // A lifetime such as `'a` is code, while a quoted scalar such as `'{'` is a character literal.
      const close = source.indexOf("'", index + 1)
      if (close > index + 1 && close - index <= 6) {
        blank(index)
        state = 'character'
      }
      index += 1
      continue
    }
    if (current === 'r') {
      const raw = source.slice(index).match(/^r(#{0,16})"/)
      if (raw) {
        rawHashes = raw[1].length
        for (let offset = 0; offset < raw[0].length; offset += 1) blank(index + offset)
        index += raw[0].length
        state = 'raw-string'
        continue
      }
    }
    index += 1
  }
  return out.join('')
}

export function matchingBrace(source, openIndex) {
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}
