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

  // Regression: several agents resuming at once start slowly, so their mode queries are answered
  // after the launch grace — and a DECRQM reply counted as typing declined every probe but the first.
  it('treats mode, keyboard-protocol and window reports, alone or batched, as automatic', () => {
    for (const reply of [
      '\x1b[?2026;2$y',
      '\x1b[?2004;1$y\x1b[?1u',
      '\x1b[8;40;120t',
      '\x1bP>|xterm.js(5.5.0)\x1b\\',
      '\x1b]10;rgb:ffff/ffff/ffff\x07\x1b[?62;22c',
    ]) {
      expect(isAutomaticTerminalReply(reply)).toBe(true)
      expect(interceptPaneInput('s1', reply, 9)).toBe(false)
    }
    expect(lastUserInputAt('s1')).toBeUndefined()
    for (const keys of ['\x1b[97u', '\x1b[1;5A', 'u', '\x1b[?2026;2$yx']) {
      expect(isAutomaticTerminalReply(keys)).toBe(false)
    }
  })

  it('does not count keys held back by a hold as typing into the pane', () => {
    const release = holdPaneInput('s1')
    expect(interceptPaneInput('s1', 'x', 7)).toBe(true)
    expect(lastUserInputAt('s1')).toBeUndefined()
    expect(release()).toBe('x')
    expect(interceptPaneInput('s1', 'y', 8)).toBe(false)
    expect(lastUserInputAt('s1')).toBe(8)
  })
})
