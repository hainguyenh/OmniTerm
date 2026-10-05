/**
 * Wire types for the editor's `open_text_file` / `save_text_file` commands, mirroring
 * `crates/app-protocol/src/text_file.rs`, plus parsers that validate the payload at the IPC boundary
 * — a malformed reply becomes a readable error instead of a crash deep inside the editor.
 */

export type TextEol = 'lf' | 'crlf'

export interface TextFileContent {
  content: string
  size: number
  mtimeMs: number
  lineCount: number
  maxLineLen: number
  eol: TextEol
  mixedEol: boolean
  hasBom: boolean
  readOnly: boolean
}

export interface TextFileSaveRequest {
  content: string
  bom: boolean
  expectedMtimeMs?: number
  expectedSize?: number
  force?: boolean
}

export type TextFileSaveOutcome =
  | { status: 'saved'; size: number; mtimeMs: number }
  | { status: 'conflict'; reason: 'modified' | 'deleted'; diskMtimeMs?: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function num(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid text file reply: ${key}`)
  return value
}

function bool(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') throw new Error(`Invalid text file reply: ${key}`)
  return value
}

export function parseTextFileContent(value: unknown): TextFileContent {
  if (!isRecord(value) || typeof value.content !== 'string') throw new Error('Invalid text file reply: content')
  if (value.eol !== 'lf' && value.eol !== 'crlf') throw new Error('Invalid text file reply: eol')
  return {
    content: value.content,
    size: num(value, 'size'),
    mtimeMs: num(value, 'mtimeMs'),
    lineCount: num(value, 'lineCount'),
    maxLineLen: num(value, 'maxLineLen'),
    eol: value.eol,
    mixedEol: bool(value, 'mixedEol'),
    hasBom: bool(value, 'hasBom'),
    readOnly: bool(value, 'readOnly'),
  }
}

export function parseSaveOutcome(value: unknown): TextFileSaveOutcome {
  if (!isRecord(value)) throw new Error('Invalid save reply')
  if (value.status === 'saved') {
    return { status: 'saved', size: num(value, 'size'), mtimeMs: num(value, 'mtimeMs') }
  }
  if (value.status === 'conflict' && (value.reason === 'modified' || value.reason === 'deleted')) {
    return typeof value.diskMtimeMs === 'number'
      ? { status: 'conflict', reason: value.reason, diskMtimeMs: value.diskMtimeMs }
      : { status: 'conflict', reason: value.reason }
  }
  throw new Error('Invalid save reply')
}
