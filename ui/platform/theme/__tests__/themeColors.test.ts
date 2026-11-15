import { describe, expect, it } from 'vitest'

import { blendOver, mixColors, opaqueHex, safeColor, safeOpaqueHex } from '../themeColors'

describe('safeColor', () => {
  it('accepts plain hex and rgb colours', () => {
    expect(safeColor('#fff')).toEqual([255, 255, 255, 1])
    expect(safeColor('#102030')).toEqual([16, 32, 48, 1])
    expect(safeColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5])
  })

  it.each([
    'red; } body { display: none',
    '#fff; background: url(http://evil)',
    'url(javascript:alert(1))',
    'expression(alert(1))',
    '#12',
    'rgb(300, 0, 0)',
    'rgb(1.2.3, 0, 0)',
    'var(--x)',
    '#fff}</style><script>',
    '',
    `#${'f'.repeat(200)}`,
  ])('rejects %s', (value) => {
    expect(safeColor(value)).toBeNull()
  })

  it('rejects values that are not strings', () => {
    for (const value of [undefined, null, 12, {}, ['#fff']]) expect(safeColor(value)).toBeNull()
  })
})

describe('colour maths', () => {
  it('blends a translucent colour over its base', () => {
    expect(blendOver([255, 255, 255, 0.5], [0, 0, 0, 1])).toEqual([127.5, 127.5, 127.5, 1])
  })

  it('mixes towards a target', () => {
    expect(mixColors([0, 0, 0, 1], [100, 200, 50, 1], 0.5)).toEqual([50, 100, 25, 1])
  })

  it('serialises opaque hex only', () => {
    expect(opaqueHex([1, 2, 3, 0.2])).toBe('#010203')
    expect(safeOpaqueHex('rgba(255, 0, 0, 0.5)', [0, 0, 0, 1])).toBe('#800000')
    expect(safeOpaqueHex('nope', [0, 0, 0, 1])).toBeNull()
  })
})
