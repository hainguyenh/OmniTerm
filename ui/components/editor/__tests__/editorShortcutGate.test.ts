import type { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { gateEditorCommand, isEditorShortcutEnabled, setDisabledEditorShortcuts } from '../editorShortcutGate'
import { resolveDisabledEditorShortcuts } from '../editorShortcuts'

const view = {} as EditorView

describe('editorShortcutGate', () => {
  afterEach(() => setDisabledEditorShortcuts(new Set()))

  it('enables every shortcut by default', () => {
    expect(isEditorShortcutEnabled('searchFile')).toBe(true)
    expect(isEditorShortcutEnabled('foldLevel1')).toBe(true)
  })

  it('runs the command while its shortcut is enabled', () => {
    const run = vi.fn(() => true)
    expect(gateEditorCommand('searchFile', run)(view)).toBe(true)
    expect(run).toHaveBeenCalledWith(view)
  })

  it('reports a switched-off shortcut as unhandled without running it', () => {
    const run = vi.fn(() => true)
    setDisabledEditorShortcuts(new Set(['searchFile']))
    expect(gateEditorCommand('searchFile', run)(view)).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('picks up a toggle made after the command was built', () => {
    const run = vi.fn(() => true)
    const gated = gateEditorCommand('foldAll', run)
    setDisabledEditorShortcuts(new Set(['foldAll']))
    expect(gated(view)).toBe(false)
    setDisabledEditorShortcuts(new Set())
    expect(gated(view)).toBe(true)
  })
})

describe('resolveDisabledEditorShortcuts', () => {
  it('keeps only known shortcut keys', () => {
    expect([...resolveDisabledEditorShortcuts(['searchGlobal', 'nope', 3, 'foldAll'])])
      .toEqual(['searchGlobal', 'foldAll'])
  })

  it('treats a missing or malformed value as nothing disabled', () => {
    expect(resolveDisabledEditorShortcuts(undefined).size).toBe(0)
    expect(resolveDisabledEditorShortcuts('searchGlobal').size).toBe(0)
  })
})
