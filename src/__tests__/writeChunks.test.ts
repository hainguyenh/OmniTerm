import { describe, expect, it } from 'vitest'
import { chunkForWrite, WRITE_CHUNK_SIZE } from '../utils/writeChunks'

describe('chunkForWrite', () => {
  it('leaves text at or below the limit as a single chunk', () => {
    const text = 'x'.repeat(WRITE_CHUNK_SIZE)
    expect(chunkForWrite(text)).toEqual([text])
    expect(chunkForWrite('')).toEqual([''])
  })

  it('splits longer text into pieces that rejoin exactly', () => {
    const text = 'abcdefghij'.repeat(500) // 5000 chars
    const chunks = chunkForWrite(text, 1024)
    expect(chunks).toHaveLength(5)
    expect(chunks.every(c => c.length <= 1024)).toBe(true)
    expect(chunks.join('')).toBe(text)
  })

  // A split between the halves of a surrogate pair would render an astral character as two
  // replacement glyphs — the one boundary xterm's parser cannot repair for us.
  it('never splits a surrogate pair', () => {
    // 'x' then 4 astral chars (2 code units each): a size-4 split would land between the halves of
    // the second pair.
    const text = 'x' + '𝄞'.repeat(4)
    const chunks = chunkForWrite(text, 4)
    expect(chunks.join('')).toBe(text)
    for (const chunk of chunks) {
      const last = chunk.charCodeAt(chunk.length - 1)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    }
  })
})
