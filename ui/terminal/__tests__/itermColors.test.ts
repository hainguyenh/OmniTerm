/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'

import { parseItermColors } from '../itermColors'

const color = (r: number, g: number, b: number) => `<dict>
  <key>Alpha Component</key><real>1</real>
  <key>Blue Component</key><real>${b}</real>
  <key>Color Space</key><string>sRGB</string>
  <key>Green Component</key><real>${g}</real>
  <key>Red Component</key><real>${r}</real>
</dict>`

const preset = (entries: Record<string, string>) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
${Object.entries(entries).map(([key, value]) => `<key>${key}</key>\n${value}`).join('\n')}
</dict></plist>`

const ansi = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`Ansi ${i} Color`, color(i / 15, 0, 1 - i / 15)]))

describe('parseItermColors', () => {
  it('reads the ANSI, base, cursor and selection colors', () => {
    const palette = parseItermColors(preset({
      ...ansi,
      'Background Color': color(0, 0, 0),
      'Foreground Color': color(1, 1, 1),
      'Cursor Color': color(1, 0, 0),
      'Cursor Text Color': color(0, 1, 0),
      'Selection Color': color(0.2, 0.2, 0.2),
      'Selected Text Color': color(0.5, 0.5, 0.5),
    }))
    expect(palette).toMatchObject({
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ff0000',
      cursorAccent: '#00ff00',
      selectionBackground: '#333333',
      selectionForeground: '#808080',
      black: '#0000ff',
      brightWhite: '#ff0000',
    })
  })

  it('defaults the cursor to the foreground and clamps out-of-range components', () => {
    const palette = parseItermColors(preset({
      ...ansi,
      'Background Color': color(-1, 0, 0),
      'Foreground Color': color(2, 1, 1),
    }))
    expect(palette?.background).toBe('#000000')
    expect(palette?.foreground).toBe('#ffffff')
    expect(palette?.cursor).toBe('#ffffff')
  })

  it('rejects files that are not complete color presets', () => {
    expect(parseItermColors('not xml')).toBeNull()
    expect(parseItermColors('<html><body/></html>')).toBeNull()
    expect(parseItermColors(preset({ 'Background Color': color(0, 0, 0), 'Foreground Color': color(1, 1, 1) }))).toBeNull()
    const { ['Ansi 3 Color']: _missing, ...incomplete } = ansi
    expect(parseItermColors(preset({
      ...incomplete,
      'Background Color': color(0, 0, 0),
      'Foreground Color': color(1, 1, 1),
    }))).toBeNull()
    expect(parseItermColors(preset({
      ...ansi,
      'Background Color': '<string>black</string>',
      'Foreground Color': color(1, 1, 1),
    }))).toBeNull()
  })
})
