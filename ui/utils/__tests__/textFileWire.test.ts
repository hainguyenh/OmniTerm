import { describe, expect, it } from 'vitest'

import { parseSaveOutcome, parseTextFileContent } from '../textFileWire'

const VALID = {
  content: 'x', size: 1, mtimeMs: 2, lineCount: 1, maxLineLen: 1, eol: 'lf',
  mixedEol: false, hasBom: false, readOnly: true,
}

describe('parseTextFileContent', () => {
  it('accepts a well-formed reply', () => {
    expect(parseTextFileContent(VALID)).toEqual(VALID)
  })

  it.each([
    ['non-object', null, 'content'],
    ['missing content', { ...VALID, content: undefined }, 'content'],
    ['bad eol', { ...VALID, eol: 'cr' }, 'eol'],
    ['bad number', { ...VALID, size: Number.NaN }, 'size'],
    ['bad flag', { ...VALID, hasBom: 'yes' }, 'hasBom'],
  ])('rejects %s', (_label, value, field) => {
    expect(() => parseTextFileContent(value)).toThrow(field)
  })
})

describe('parseSaveOutcome', () => {
  it('accepts saved and both conflict shapes', () => {
    expect(parseSaveOutcome({ status: 'saved', size: 3, mtimeMs: 4 })).toEqual({ status: 'saved', size: 3, mtimeMs: 4 })
    expect(parseSaveOutcome({ status: 'conflict', reason: 'modified', diskMtimeMs: 7 }))
      .toEqual({ status: 'conflict', reason: 'modified', diskMtimeMs: 7 })
    expect(parseSaveOutcome({ status: 'conflict', reason: 'deleted' })).toEqual({ status: 'conflict', reason: 'deleted' })
  })

  it.each([
    ['non-object', 'saved'],
    ['unknown status', { status: 'other' }],
    ['unknown reason', { status: 'conflict', reason: 'renamed' }],
    ['bad size', { status: 'saved', size: '3', mtimeMs: 4 }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseSaveOutcome(value)).toThrow()
  })
})
