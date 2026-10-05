import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  conflictResolutionChange,
  extractVersions,
  hasConflictMarkers,
  parseConflictBlocks,
  resolveConflict,
} from '../gitConflictUtils'

const SAMPLE_CONFLICT = `line 1
<<<<<<< HEAD
local changes here
=======
server changes here
>>>>>>> origin/main
line 5`

describe('gitConflictUtils', () => {
  it('detects conflict markers', () => {
    expect(hasConflictMarkers(SAMPLE_CONFLICT)).toBe(true)
    expect(hasConflictMarkers('regular file\nwithout conflicts')).toBe(false)
  })

  it('parses conflict blocks correctly', () => {
    const blocks = parseConflictBlocks(SAMPLE_CONFLICT)
    expect(blocks.length).toBe(1)
    expect(blocks[0].startLine).toBe(1)
    expect(blocks[0].endLine).toBe(5)
    expect(blocks[0].ours).toBe('local changes here')
    expect(blocks[0].theirs).toBe('server changes here')
  })

  it('resolves conflict block with theirs or ours', () => {
    const blocks = parseConflictBlocks(SAMPLE_CONFLICT)
    const withTheirs = resolveConflict(SAMPLE_CONFLICT, blocks[0], 'theirs')
    expect(withTheirs).toBe('line 1\nserver changes here\nline 5')

    const withOurs = resolveConflict(SAMPLE_CONFLICT, blocks[0], 'ours')
    expect(withOurs).toBe('line 1\nlocal changes here\nline 5')
  })

  it('extracts theirsText and oursText cleanly', () => {
    const res = extractVersions(SAMPLE_CONFLICT)
    expect(res.hasConflicts).toBe(true)
    expect(res.conflictCount).toBe(1)
    expect(res.theirsText).toBe('line 1\nserver changes here\nline 5')
    expect(res.oursText).toBe('line 1\nlocal changes here\nline 5')
  })
})

describe('conflictResolutionChange', () => {
  const apply = (text: string, choice: 'theirs' | 'ours') => {
    const doc = Text.of(text.split('\n'))
    const [block] = parseConflictBlocks(text)
    const change = conflictResolutionChange(doc, block, choice)
    return doc.replace(change.from, change.to, Text.of(change.insert.split('\n'))).toString()
  }

  it('matches resolveConflict for both sides', () => {
    for (const choice of ['theirs', 'ours'] as const) {
      const [block] = parseConflictBlocks(SAMPLE_CONFLICT)
      expect(apply(SAMPLE_CONFLICT, choice)).toBe(resolveConflict(SAMPLE_CONFLICT, block, choice))
    }
  })

  it('removes an empty side with one line break wherever the block sits', () => {
    const middle = 'a\n<<<<<<< HEAD\n=======\nx\n>>>>>>> b\nz'
    const end = 'a\n<<<<<<< HEAD\n=======\nx\n>>>>>>> b'
    const whole = '<<<<<<< HEAD\n=======\nx\n>>>>>>> b'
    for (const text of [middle, end, whole]) {
      const [block] = parseConflictBlocks(text)
      expect(apply(text, 'ours')).toBe(resolveConflict(text, block, 'ours'))
    }
  })
})
