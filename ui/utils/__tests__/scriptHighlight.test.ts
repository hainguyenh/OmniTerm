import { describe, it, expect } from 'vitest'
import { highlightLine, highlightLines, type Token } from '../scriptHighlight'

/** The concatenation of token texts must always reconstruct the original line exactly. */
function reconstruct(tokens: Token[]): string {
  return tokens.map((t) => t.text).join('')
}
const typeOf = (tokens: Token[], text: string) => tokens.find((t) => t.text === text)?.type

describe('scriptHighlight', () => {
  it('never loses characters (concatenation reconstructs the line)', () => {
    for (const [line, kind] of [
      ['echo hi # greet', 'sh'],
      ['set X=1 :: note', 'bat'],
      ['$env = "a#b" # real', 'ps1'],
    ] as const) {
      expect(reconstruct(highlightLine(line, kind))).toBe(line)
    }
  })

  it('colors keywords, comments and variables for shell', () => {
    const t = highlightLine('echo $HOME # greet', 'sh')
    expect(typeOf(t, 'echo')).toBe('keyword')
    expect(typeOf(t, '$HOME')).toBe('variable')
    expect(typeOf(t, '# greet')).toBe('comment')
  })

  it('does not treat # inside a string as a comment', () => {
    const t = highlightLine('x = "a#b" # real', 'ps1')
    expect(typeOf(t, '"a#b"')).toBe('string')
    expect(typeOf(t, '# real')).toBe('comment')
  })

  it('treats rem / :: lines as whole-line comments for batch, and % vars', () => {
    expect(highlightLine('  REM setup', 'bat')).toEqual([{ text: '  REM setup', type: 'comment' }])
    expect(typeOf(highlightLine('echo %PATH%', 'bat'), '%PATH%')).toBe('variable')
    // '#' is NOT a comment in batch.
    expect(highlightLine('echo x', 'bat').some((t) => t.type === 'comment')).toBe(false)
  })

  it('colors numbers that are not part of an identifier', () => {
    const t = highlightLine('sleep 30', 'sh')
    expect(typeOf(t, '30')).toBe('number')
  })

  it('splits a document into per-line token arrays', () => {
    const lines = highlightLines('a\n# c', 'sh')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toEqual([{ text: '# c', type: 'comment' }])
  })
})

describe('unknown kinds', () => {
  /**
   * The viewer opens every text file now, and these rules are written for shell syntax. Applied to
   * prose they mislead: the apostrophe in "don't" would open a string that colors the rest of the
   * line. An unknown kind therefore gets one plain token and stays legible.
   */
  it('does not tokenize prose as shell syntax', () => {
    const line = "Don't set $5 aside — # not a comment"
    expect(highlightLine(line, 'txt')).toEqual([{ text: line, type: 'text' }])
    expect(highlightLine(line, 'md')).toEqual([{ text: line, type: 'text' }])
    expect(highlightLine(line, 'json')).toEqual([{ text: line, type: 'text' }])
  })

  it('still tokenizes the kinds it was written for', () => {
    expect(highlightLine('# comment', 'sh')).toEqual([{ text: '# comment', type: 'comment' }])
    expect(highlightLine('REM off', 'bat')[0].type).toBe('comment')
  })

  it('returns no tokens for a blank line', () => {
    expect(highlightLine('', 'txt')).toEqual([])
  })
})
