import { describe, it, expect } from 'vitest'
import { matchShortcut } from '../keyboard'

const key = (overrides: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ key: '', code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...overrides }) as KeyboardEvent

describe('matchShortcut', () => {
  it('matches a plain Ctrl+letter combo', () => {
    expect(matchShortcut(key({ key: 'n', ctrlKey: true }), 'Ctrl+N')).toBe(true)
    expect(matchShortcut(key({ key: 'n', ctrlKey: false }), 'Ctrl+N')).toBe(false)
  })

  it('treats Ctrl and Cmd (metaKey) as equivalent', () => {
    expect(matchShortcut(key({ key: 'n', metaKey: true }), 'Ctrl+N')).toBe(true)
  })

  it('is modifier-exclusive: an extra Shift breaks the match', () => {
    expect(matchShortcut(key({ key: 'n', ctrlKey: true, shiftKey: true }), 'Ctrl+N')).toBe(false)
  })

  it('matches Ctrl+= and Ctrl++ interchangeably, including the numpad key', () => {
    expect(matchShortcut(key({ key: '=', ctrlKey: true }), 'Ctrl+=')).toBe(true)
    expect(matchShortcut(key({ key: '+', ctrlKey: true }), 'Ctrl+=')).toBe(true)
    expect(matchShortcut(key({ key: 'Add', code: 'NumpadAdd', ctrlKey: true }), 'Ctrl+=')).toBe(true)
  })

  it('matches Ctrl+- including the numpad key', () => {
    expect(matchShortcut(key({ key: '-', ctrlKey: true }), 'Ctrl+-')).toBe(true)
    expect(matchShortcut(key({ key: 'Subtract', code: 'NumpadSubtract', ctrlKey: true }), 'Ctrl+-')).toBe(true)
  })

  it('returns false for an empty binding', () => {
    expect(matchShortcut(key({ key: 'n', ctrlKey: true }), '')).toBe(false)
  })
})
