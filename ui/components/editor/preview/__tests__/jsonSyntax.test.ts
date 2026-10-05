import { describe, expect, it } from 'vitest'

import { jsonErrorOffset } from '../jsonSyntax'

describe('jsonErrorOffset', () => {
  it.each([
    '{}', '[]', ' { "a" : [1, -2.5e+3, true, false, null, "x\\n\\u00e9"] } ', '"top"', '0', '{"a":{"b":[[]]}}',
  ])('accepts valid JSON %s', (text) => {
    expect(() => JSON.parse(text)).not.toThrow()
    expect(jsonErrorOffset(text)).toBeNull()
  })

  it.each([
    ['', 0], ['{', 1], ['{"a" 1}', 5], ['{"a":}', 5], ['{a:1}', 1], ['[1 2]', 3], ['[1,]', 3],
    ['{"a":1,}', 7], ['[1]]', 3], ['{"a":1]', 6], ['"abc', 4], ['"a\tb"', 2], ['"\\x"', 1],
    ['"\\u12G4"', 1], ['01', 1], ['tru', 0], ['nul', 0], ['[1] 2', 4], ['-', 0],
  ])('points at the error in %j', (text, offset) => {
    expect(() => JSON.parse(text)).toThrow()
    expect(jsonErrorOffset(text)).toBe(offset)
  })

  it('handles very deep nesting without recursion', () => {
    const deep = '['.repeat(100_000) + ']'.repeat(99_999)
    expect(jsonErrorOffset(deep)).toBe(deep.length)
  })
})
