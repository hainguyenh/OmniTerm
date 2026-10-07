/** @vitest-environment jsdom */
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

import { createEditorFoldKeymap, foldAll, foldCode, foldLevel, jetbrainsFoldKeymap, unfoldAll, unfoldCode } from '../editorFolding'
import { eslintRuler } from '../editorRuler'
import { setDisabledEditorShortcuts } from '../editorShortcutGate'
import { installCodeMirrorShims } from './cmShims'

beforeAll(installCodeMirrorShims)

describe('editorFolding', () => {
  it('defines jetbrains fold keymap bindings', () => {
    const keys = jetbrainsFoldKeymap.map((b) => b.key)
    expect(keys).toContain('Mod-Shift--')
    expect(keys).toContain('Mod-Shift-=')
    expect(keys).toContain('Mod-Shift-+')
    expect(keys).toContain('Mod--')
    expect(keys).toContain('Mod-=')
    expect(keys).toContain('Mod-+')
    expect(keys).toContain('Mod-Shift-1')
    expect(keys).toContain('Mod-Shift-2')
  })

  it('creates custom fold keymap bindings from user settings', () => {
    const keymap = createEditorFoldKeymap({
      foldLevel1: 'Alt+1',
      foldAll: 'Ctrl+Alt+[',
      unfoldAll: 'Ctrl+Alt+]',
    })
    const keys = keymap.map((b) => b.key)
    expect(keys).toContain('Alt-1')
    expect(keys).toContain('Mod-Alt-[')
    expect(keys).toContain('Mod-Alt-]')
  })

  it('lets a switched-off fold shortcut fall through without running', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'a' }) })
    const foldAllBinding = createEditorFoldKeymap().find((b) => b.key === 'Mod-Shift--')
    try {
      setDisabledEditorShortcuts(new Set(['foldAll']))
      expect(foldAllBinding?.run?.(view)).toBe(false)
    } finally {
      setDisabledEditorShortcuts(new Set())
      view.destroy()
    }
  })

  it('runs foldLevel without crashing on plain editor state', () => {
    const state = EditorState.create({
      doc: 'function a() {\n  return 1\n}\n',
    })
    const view = new EditorView({ state })

    // Without syntax extensions, foldLevel returns false gracefully
    const handled = foldLevel(view, 1)
    expect(handled).toBe(false)

    // foldLevel handles non-positive targets gracefully
    expect(foldLevel(view, 0)).toBe(false)
    expect(foldLevel(view, -1)).toBe(false)

    // foldAll / unfoldAll run without throwing
    expect(typeof foldAll).toBe('function')
    expect(typeof unfoldAll).toBe('function')
    expect(typeof foldCode).toBe('function')
    expect(typeof unfoldCode).toBe('function')
    view.destroy()
  })

  it('creates eslintRuler extension for columns', () => {
    const rulers = eslintRuler([80, 100])
    expect(rulers).toBeDefined()
    expect(Array.isArray(rulers)).toBe(true)

    const state = EditorState.create({
      doc: 'hello world',
      extensions: [rulers],
    })
    const parent = document.createElement('div')
    const view = new EditorView({ state, parent })

    const rulerEls = parent.querySelectorAll('.cm-eslint-ruler')
    expect(rulerEls.length).toBe(2)
    expect(parent.querySelector('.cm-eslint-ruler-80')).not.toBeNull()
    expect(parent.querySelector('.cm-eslint-ruler-100')).not.toBeNull()

    view.destroy()
  })
})
