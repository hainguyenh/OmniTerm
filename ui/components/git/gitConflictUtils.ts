import type { Text } from '@codemirror/state'

export interface ConflictBlock {
  index: number
  startLine: number
  endLine: number
  header: string
  ours: string
  theirs: string
  footer: string
}

export function hasConflictMarkers(text: string): boolean {
  if (!text) return false
  return text.includes('<<<<<<<') && text.includes('=======') && text.includes('>>>>>>>')
}

export function parseConflictBlocks(text: string): ConflictBlock[] {
  if (!text) return []
  const lines = text.split('\n')
  const blocks: ConflictBlock[] = []
  let inConflict = false
  let currentStart = 0
  let header = ''
  let oursLines: string[] = []
  let theirsLines: string[] = []
  let readingTheirs = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('<<<<<<<')) {
      inConflict = true
      currentStart = i
      header = line
      oursLines = []
      theirsLines = []
      readingTheirs = false
    } else if (inConflict && line.startsWith('=======')) {
      readingTheirs = true
    } else if (inConflict && line.startsWith('>>>>>>>')) {
      blocks.push({
        index: blocks.length,
        startLine: currentStart,
        endLine: i,
        header,
        ours: oursLines.join('\n'),
        theirs: theirsLines.join('\n'),
        footer: line,
      })
      inConflict = false
    } else if (inConflict) {
      if (readingTheirs) {
        theirsLines.push(line)
      } else {
        // Skip base section in diff3 mode (|||||||)
        if (!line.startsWith('|||||||')) {
          oursLines.push(line)
        }
      }
    }
  }

  return blocks
}

export function resolveConflict(
  text: string,
  block: ConflictBlock,
  choice: 'theirs' | 'ours',
): string {
  const lines = text.split('\n')
  const replacement = choice === 'theirs' ? block.theirs : block.ours
  const repLines = replacement ? replacement.split('\n') : []
  lines.splice(block.startLine, block.endLine - block.startLine + 1, ...repLines)
  return lines.join('\n')
}

/**
 * The same resolution as `resolveConflict`, expressed as one minimal edit to an editor document so
 * the editor keeps its undo history and scroll position instead of being reset with new text.
 */
export function conflictResolutionChange(
  doc: Text,
  block: ConflictBlock,
  choice: 'theirs' | 'ours',
): { from: number; to: number; insert: string } {
  const first = doc.line(block.startLine + 1)
  const last = doc.line(block.endLine + 1)
  const replacement = choice === 'theirs' ? block.theirs : block.ours
  if (replacement) return { from: first.from, to: last.to, insert: replacement }
  // An empty side drops the block's lines entirely, including one line break.
  if (last.number < doc.lines) return { from: first.from, to: last.to + 1, insert: '' }
  if (first.number > 1) return { from: first.from - 1, to: last.to, insert: '' }
  return { from: 0, to: doc.length, insert: '' }
}

export function extractVersions(text: string): {
  theirsText: string
  oursText: string
  hasConflicts: boolean
  conflictCount: number
} {
  const blocks = parseConflictBlocks(text)
  if (blocks.length === 0) {
    return { theirsText: text, oursText: text, hasConflicts: false, conflictCount: 0 }
  }

  let theirsText = text
  let oursText = text

  // Process blocks in reverse order so line numbers don't shift
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    theirsText = resolveConflict(theirsText, b, 'theirs')
    oursText = resolveConflict(oursText, b, 'ours')
  }

  return {
    theirsText,
    oursText,
    hasConflicts: true,
    conflictCount: blocks.length,
  }
}
