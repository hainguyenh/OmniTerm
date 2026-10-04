import { EditorState, Text } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'

import {
  applyEffects, createDocState, createDocumentModel, currentState, escalatedProfile, quickDirty, serialize,
} from '../documentModel'
import { profileSlot, profileExtensions, readOnlySlot } from '../editorExtensions'
import { extensionOf, previewKindFor, PREVIEW_LIMITS } from '../editorFileKinds'
import { debounceFor, LARGE_FILE_CHARS, LONG_LINE_CHARS, profileFor, profileNotice } from '../fileProfile'
import type { TextFileContent } from '../../../utils/textFileWire'

const file = (content: string, extra: Partial<TextFileContent> = {}): TextFileContent => ({
  content, size: content.length, mtimeMs: 1, lineCount: content.split(/\r\n|\r|\n/).length,
  maxLineLen: Math.max(...content.split(/\r\n|\r|\n/).map((line) => line.length)), eol: 'lf',
  mixedEol: false, hasBom: false, readOnly: false, ...extra,
})

describe('fileProfile', () => {
  it('picks the profile from size, line count and longest line', () => {
    expect(profileFor({ chars: 10, lines: 1, maxLineLen: 10 })).toBe('full')
    expect(profileFor({ chars: LARGE_FILE_CHARS + 1, lines: 1, maxLineLen: 1 })).toBe('large')
    expect(profileFor({ chars: 10, lines: 50_001, maxLineLen: 1 })).toBe('large')
    expect(profileFor({ chars: 10, lines: 1, maxLineLen: LONG_LINE_CHARS + 1 })).toBe('longLines')
  })

  it('explains degraded profiles and scales the preview debounce', () => {
    expect(profileNotice('full')).toBeNull()
    expect(profileNotice('large')).toMatch(/Large file/)
    expect(profileNotice('longLines')).toMatch(/long lines/)
    expect(debounceFor(10)).toBe(300)
    expect(debounceFor(512 * 1024)).toBe(800)
    expect(debounceFor(5 * 1024 * 1024)).toBe(1500)
  })
})

describe('editorFileKinds', () => {
  it('maps extensions to preview kinds', () => {
    expect(previewKindFor('README.md')).toBe('markdown')
    expect(previewKindFor('data.TSV')).toBe('csv')
    expect(previewKindFor('index.htm')).toBe('html')
    expect(previewKindFor('package.json')).toBe('json')
    expect(previewKindFor('icon.SVG')).toBe('svg')
    expect(previewKindFor('main.rs')).toBeNull()
    expect(previewKindFor('.env')).toBeNull()
    expect(extensionOf('archive.tar.GZ')).toBe('gz')
    expect(PREVIEW_LIMITS.markdown.autoRender).toBeLessThan(PREVIEW_LIMITS.markdown.hardCap)
  })
})

describe('documentModel', () => {
  it('builds a state with the profile, cursor restore and read-only flag', () => {
    const { state, profile } = createDocState(file('a\nbc'), () => {}, 99)
    expect(profile).toBe('full')
    expect(state.doc.lines).toBe(2)
    expect(state.selection.main.head).toBe(4)
    expect(state.readOnly).toBe(false)
    const readOnly = createDocState(file('x', { readOnly: true }), () => {}, null)
    expect(readOnly.state.readOnly).toBe(true)
    expect(readOnly.state.selection.main.head).toBe(0)
    const minified = createDocState(file('x'.repeat(LONG_LINE_CHARS + 1)), () => {}, -5)
    expect(minified.profile).toBe('longLines')
    expect(minified.state.selection.main.head).toBe(0)
  })

  it('serializes with one line ending throughout, including mixed input', () => {
    const { state } = createDocState(file('a\r\nb\nc\rd'), () => {}, null)
    expect(state.doc.lines).toBe(4)
    expect(serialize(state.doc, 'crlf')).toBe('a\r\nb\r\nc\r\nd')
    expect(serialize(state.doc, 'lf')).toBe('a\nb\nc\nd')
  })

  it('answers the dirty check cheaply when it can', () => {
    const saved = Text.of(['abc'])
    expect(quickDirty(saved, null)).toBe(false)
    expect(quickDirty(saved, saved)).toBe(false)
    expect(quickDirty(Text.of(['abcd']), saved)).toBe(true)
    expect(quickDirty(Text.of(['abd']), saved)).toBeUndefined()
  })

  it('escalates to the large profile when the document grows, never back', () => {
    expect(escalatedProfile('full', Text.of(['small']))).toBe('full')
    expect(escalatedProfile('longLines', Text.of(['x'.repeat(LARGE_FILE_CHARS + 1)]))).toBe('large')
    expect(escalatedProfile('large', Text.of(['x']))).toBe('large')
  })

  it('applies effects to the stored state when no current view shows it', () => {
    const model = createDocumentModel()
    applyEffects(model, [])
    expect(currentState(model)).toBeNull()
    model.state = EditorState.create({ doc: 'x', extensions: [readOnlySlot.of(EditorState.readOnly.of(false))] })
    applyEffects(model, [readOnlySlot.reconfigure(EditorState.readOnly.of(true))])
    expect(model.state.readOnly).toBe(true)

    const dispatch = vi.fn()
    const staleView = { state: EditorState.create({ doc: 'old' }), dispatch }
    model.view = staleView as unknown as typeof model.view
    applyEffects(model, [readOnlySlot.reconfigure(EditorState.readOnly.of(false))])
    expect(dispatch).not.toHaveBeenCalled()
    expect(model.state.readOnly).toBe(false)
    expect(currentState(model)).toBe(staleView.state)
  })

  it('dispatches to a view that shows the model state', () => {
    const model = createDocumentModel()
    model.state = EditorState.create({ doc: 'x' })
    const dispatch = vi.fn()
    model.view = { state: model.state, dispatch } as unknown as typeof model.view
    applyEffects(model, [])
    expect(dispatch).toHaveBeenCalledWith({ effects: [] })
  })
})

describe('editorExtensions', () => {
  it('only adds whole-document features in the full profile', () => {
    expect(profileExtensions('full')).toHaveLength(6)
    expect(profileExtensions('large')).toEqual([])
    expect(profileExtensions('longLines')).toEqual([])
    const state = EditorState.create({ extensions: [profileSlot.of(profileExtensions('large'))] })
    expect(profileSlot.get(state)).toEqual([])
  })
})
