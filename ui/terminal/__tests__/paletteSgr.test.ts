import { describe, expect, it } from 'vitest'

import { OutputHighlighter } from '../../highlighter'
import { fgForRgb, nearestAnsi, paletteSgr } from '../paletteSgr'
import { DEFAULT_TERMINAL_LOOK, parseTerminalLook, resolveTerminalLook } from '../terminalLook'

describe('paletteSgr', () => {
  it('maps 24-bit foregrounds to the nearest ANSI slot', () => {
    expect(paletteSgr('\x1b[38;2;204;0;0m')).toBe('\x1b[31m')
    expect(paletteSgr('\x1b[38;2;100;200;60m')).toBe('\x1b[32m')
    expect(paletteSgr('\x1b[38;2;140;230;100m')).toBe('\x1b[92m')
    expect(paletteSgr('\x1b[38;2;120;120;120m')).toBe('\x1b[90m')
    expect(paletteSgr('\x1b[1;38;2;52;101;164m')).toBe('\x1b[1;34m')
  })

  it('maps 256-color foregrounds, keeping the 16 base indexes as they are', () => {
    expect(paletteSgr('\x1b[38;5;9m')).toBe('\x1b[91m')
    expect(paletteSgr('\x1b[38;5;2m')).toBe('\x1b[32m')
    expect(paletteSgr('\x1b[38;5;196m')).toBe(`\x1b[${fgForRgb(255, 0, 0)}m`)
  })

  it('gives body-text white and black to the scheme foreground', () => {
    expect(paletteSgr('\x1b[38;2;255;255;255m')).toBe('\x1b[39m')
    expect(paletteSgr('\x1b[38;2;0;0;0m')).toBe('\x1b[39m')
    expect(paletteSgr('\x1b[38;5;231m')).toBe('\x1b[39m')
  })

  it('leaves backgrounds, other sequences and unreadable colors untouched', () => {
    expect(paletteSgr('\x1b[48;2;40;60;40m')).toBe('\x1b[48;2;40;60;40m')
    expect(paletteSgr('\x1b[48;2;40;60;40;38;2;204;0;0m')).toBe('\x1b[48;2;40;60;40;31m')
    expect(paletteSgr('\x1b[48;5;22;38;5;9m')).toBe('\x1b[48;5;22;91m')
    for (const seq of ['\x1b[31m', '\x1b[0m', '\x1b[2J', '\x1b[38:2::1:2:3m', '\x1b[38;2;300;0;0m', '\x1b[38;2;1m', '\x1b[38;7m', ']0;t\x07']) {
      expect(paletteSgr(seq), JSON.stringify(seq)).toBe(seq)
    }
  })

  it('keeps hue families apart', () => {
    // Claude Code's orange and a purple stay distinct from each other and from grey.
    const slots = [nearestAnsi(215, 119, 87), nearestAnsi(177, 185, 249), nearestAnsi(153, 153, 153)]
    expect(new Set(slots).size).toBe(3)
  })
})

describe('OutputHighlighter palette colors', () => {
  it('rewrites only escape parameters, never the text, and only when asked', () => {
    const input = 'a\x1b[38;2;204;0;0mred\x1b[39m b'
    const highlighter = new OutputHighlighter()
    expect(highlighter.transform(input, 'none')).toBe(input)
    highlighter.setPaletteColors(true)
    expect(highlighter.transform(input, 'none')).toBe('a\x1b[31mred\x1b[39m b')
  })

  it('rewrites a color split across two chunks once it is complete', () => {
    const highlighter = new OutputHighlighter()
    highlighter.setPaletteColors(true)
    expect(highlighter.transform('x\x1b[38;2;20', 'none')).toBe('x')
    expect(highlighter.transform('4;0;0my', 'none')).toBe('\x1b[31my')
  })
})

describe('themeColors setting', () => {
  it('defaults on, reads a stored boolean and reaches the resolved look', () => {
    expect(DEFAULT_TERMINAL_LOOK.themeColors).toBe(true)
    expect(parseTerminalLook({}).themeColors).toBe(true)
    expect(parseTerminalLook({ themeColors: false }).themeColors).toBe(false)
    expect(parseTerminalLook({ themeColors: 'no' }).themeColors).toBe(true)
    expect(resolveTerminalLook({ themeColors: false }, undefined, true).themeColors).toBe(false)
  })
})
