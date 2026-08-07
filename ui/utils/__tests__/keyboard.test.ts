import { describe, expect, it } from 'vitest'
import { matchShortcut } from '../keyboard'

function key(
  value: string,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>> = {},
): KeyboardEvent {
  return {
    key: value,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  } as KeyboardEvent
}

describe('matchShortcut', () => {
  it('rejects an empty shortcut or a modifier-only shortcut', () => {
    expect(matchShortcut(key('n'), '')).toBe(false)
    expect(matchShortcut(key('Control', { ctrlKey: true }), 'Ctrl+Shift')).toBe(false)
  })

  it('matches keys case-insensitively with exact modifiers', () => {
    expect(matchShortcut(key('N', { ctrlKey: true, shiftKey: true }), 'Ctrl + Shift + n')).toBe(true)
    expect(matchShortcut(key('n', { ctrlKey: true }), 'Ctrl+Shift+N')).toBe(false)
    expect(matchShortcut(key('n', { ctrlKey: true, altKey: true }), 'Ctrl+N')).toBe(false)
  })

  it('treats meta as command-or-control', () => {
    expect(matchShortcut(key('p', { metaKey: true }), 'CommandOrControl+P')).toBe(true)
    expect(matchShortcut(key('p', { metaKey: true }), 'Cmd+P')).toBe(true)
  })

  it('accepts either plus-key representation', () => {
    expect(matchShortcut(key('+', { ctrlKey: true }), 'Ctrl++')).toBe(true)
    expect(matchShortcut(key('=', { ctrlKey: true }), 'Ctrl+Plus')).toBe(false)
    expect(matchShortcut(key('=', { ctrlKey: true }), 'Ctrl+=')).toBe(true)
  })
})
