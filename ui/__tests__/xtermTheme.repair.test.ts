/**
 * The colour-space arms of the theme repair.
 *
 * `xtermTheme.test.ts` covers the repair as a behaviour — "an invisible colour comes back legible".
 * Getting there runs the colour through hex expansion, RGB→HSL→RGB and a lightness walk, and each of
 * those branches on the input's hue, lightness and the direction of the background. A theme that
 * shipped a shorthand hex, or a magenta on a mid-grey background, would take a path nothing else
 * exercises — so this file picks inputs by which arm they land in.
 */
import { describe, it, expect } from 'vitest'
import { normalizeXtermTheme } from '../utils/xtermTheme'
import { TOKYO_NIGHT, type TerminalTheme } from '../themes'

const base: TerminalTheme = { ...TOKYO_NIGHT.terminal.dark }

const rgbOf = (hex: string) => {
  const body = hex.slice(1)
  const full = body.length === 3 || body.length === 4
    ? body.split('').map((c) => c + c).join('')
    : body
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}
const luminance = (hex: string) => {
  const { r, g, b } = rgbOf(hex)
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('hex forms', () => {
  it.each([
    ['3-digit shorthand', '#123'],
    ['4-digit shorthand with alpha', '#1234'],
    ['6-digit', '#112233'],
    ['8-digit with alpha', '#11223344'],
  ])('repairs a %s colour that is invisible on its background', (_label, red) => {
    // Every form has to survive expansion before it can be nudged; a shorthand that was not expanded
    // would be parsed as `NaN` channels and come back as `#000000`.
    const out = normalizeXtermTheme({ ...base, background: '#111111', red })
    expect(out.red).toMatch(/^#[0-9a-f]{6}$/i)
    expect(contrast(out.red!, '#111111')).toBeGreaterThan(1.6)
  })

  it.each([
    ['too short', '#12'],
    ['a bad length', '#12345'],
    ['non-hex digits', '#gggggg'],
    ['missing the hash', '112233'],
    ['empty', ''],
  ])('drops a colour that is %s', (_label, red) => {
    expect(normalizeXtermTheme({ ...base, background: '#111111', red }).red).toBeUndefined()
  })
})

describe('hue arms of the repair', () => {
  // One near-black colour per 60° sector. Each is close enough to `#000000` to fail the minimum
  // contrast check, so each is pushed lighter through the HSL round-trip for its own hue range.
  it.each([
    ['red, 0-60°', '#2a1a0a'],
    ['yellow-green, 60-120°', '#1a2a0a'],
    ['green-cyan, 120-180°', '#0a2a1a'],
    ['cyan-blue, 180-240°', '#0a1a2a'],
    ['blue-magenta, 240-300°', '#1a0a2a'],
    ['magenta-red, 300-360°', '#2a0a1a'],
  ])('repairs a %s colour while keeping it recognizably that colour', (_label, red) => {
    const out = normalizeXtermTheme({ ...base, background: '#000000', red })!
    expect(contrast(out.red!, '#000000')).toBeGreaterThan(1.6)

    // The dominant channel must survive the repair — a hue arm that computed the wrong sector would
    // come back as a different colour entirely.
    const before = rgbOf(red)
    const after = rgbOf(out.red!)
    const dominant = (c: { r: number; g: number; b: number }) =>
      Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]
    expect(dominant(after)).toBe(dominant(before))
  })

  it('repairs an achromatic colour, which has no hue to preserve', () => {
    const out = normalizeXtermTheme({ ...base, background: '#000000', red: '#0d0d0d' })
    expect(contrast(out.red!, '#000000')).toBeGreaterThan(1.6)
  })
})

describe('direction of the repair', () => {
  it('pushes a colour lighter on a dark background', () => {
    const out = normalizeXtermTheme({ ...base, background: '#0a0a0a', red: '#141414' })
    expect(luminance(out.red!)).toBeGreaterThan(luminance('#141414'))
  })

  it('pushes a colour darker on a light background', () => {
    // A light background also drives `l > 0.5` in the RGB→HSL conversion, the other arm from every
    // near-black case above.
    const out = normalizeXtermTheme({ ...base, background: '#ffffff', red: '#f4f4f4' })
    expect(luminance(out.red!)).toBeLessThan(luminance('#f4f4f4'))
  })

  it('gives up at the end of the lightness range instead of looping', () => {
    // `#acacac` sits at ~0.42 luminance: below 0.5, so the repair walks *lighter* — but even pure
    // white only reaches ~2.2 against it, short of the 2.5 target. The walk must stop when lightness
    // saturates rather than spinning out its step budget.
    const out = normalizeXtermTheme({ ...base, background: '#acacac', red: '#b0b0b0' })
    expect(out.red).toBe('#ffffff')
  })
})

describe('selection and cursor colours', () => {
  it('passes valid selection colours through without repairing them', () => {
    // They are drawn over the selection, not the pane background, so `background` is the wrong
    // reference to repair against — even a colour identical to it must survive untouched.
    const out = normalizeXtermTheme({
      ...base,
      background: '#111111',
      selectionBackground: '#111111',
      selectionForeground: '#111111',
    })
    expect(out.selectionBackground).toBe('#111111')
    expect(out.selectionForeground).toBe('#111111')
  })

  it('drops invalid selection colours', () => {
    const out = normalizeXtermTheme({
      ...base,
      selectionBackground: 'rgb(0,0,0)',
      selectionForeground: '#zzz',
    })
    expect(out.selectionBackground).toBeUndefined()
    expect(out.selectionForeground).toBeUndefined()
  })

  it('falls back to the repaired foreground for a missing cursor', () => {
    const out = normalizeXtermTheme({ ...base, cursor: '', foreground: '#c0caf5' })
    expect(out.cursor).toBe('#c0caf5')
  })

  it('falls back to a known-good cursor when the foreground is invalid too', () => {
    const out = normalizeXtermTheme({ ...base, cursor: '', foreground: 'inherit' })
    expect(out.foreground).toBeUndefined()
    expect(out.cursor).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('always leaves the cursor legible against the glyph drawn on it', () => {
    const out = normalizeXtermTheme({ ...base, cursor: '#808080', cursorAccent: '#828282' })
    expect(contrast(out.cursor!, out.cursorAccent!)).toBeGreaterThan(1.6)
  })
})
