import { beforeEach, describe, expect, it } from 'vitest'

import { holdPaneInput, interceptPaneInput, isAutomaticTerminalReply, lastUserInputAt, resetPaneInputHoldForTests } from '../paneInputHold'

beforeEach(() => resetPaneInputHoldForTests())

describe('paneInputHold', () => {
  it('passes input through when nothing holds the pane', () => {
    expect(interceptPaneInput('s1', 'a', 5)).toBe(false)
    expect(lastUserInputAt('s1')).toBe(5)
  })

  it('buffers keystrokes during a hold and returns them, in order, on release', () => {
    const release = holdPaneInput('s1')
    expect(interceptPaneInput('s1', 'he')).toBe(true)
    expect(interceptPaneInput('s1', 'llo')).toBe(true)
    expect(interceptPaneInput('s2', 'x')).toBe(false)
    expect(release()).toBe('hello')
    expect(interceptPaneInput('s1', '!')).toBe(false)
  })

  it('always lets the terminal\'s own replies through, and does not count them as typing', () => {
    const release = holdPaneInput('s1')
    for (const reply of ['\x1b[12;40R', '\x1b[?62;22c', '\x1b[I', '\x1b]11;rgb:0000/0000/0000\x1b\\']) {
      expect(isAutomaticTerminalReply(reply)).toBe(true)
      expect(interceptPaneInput('s1', reply)).toBe(false)
    }
    expect(lastUserInputAt('s1')).toBeUndefined()
    expect(isAutomaticTerminalReply('\x1b[A')).toBe(false)
    expect(release()).toBe('')
  })
})
