import { describe, expect, it } from 'vitest'

import { OutputRate, ScrollbackBuffer } from '../scrollbackBuffer'

describe('ScrollbackBuffer', () => {
  it('keeps the newest characters up to its limit', () => {
    const buffer = new ScrollbackBuffer(10)
    buffer.append('0123456')
    buffer.append('789ab')
    expect(buffer.text()).toBe('23456789ab')
    buffer.append('')
    expect(buffer.text()).toBe('23456789ab')
  })

  it('joins many small pieces in order, however many arrive', () => {
    const buffer = new ScrollbackBuffer(1_000)
    let expected = ''
    for (let i = 0; i < 5_000; i++) {
      const piece = `${i},`
      buffer.append(piece)
      expected += piece
    }
    expect(buffer.text()).toBe(expected.slice(-1_000))
  })

  it('starts over from restored history', () => {
    const buffer = new ScrollbackBuffer(5)
    buffer.append('old')
    buffer.replace('restored')
    expect(buffer.text()).toBe('tored')
    buffer.append('!')
    expect(buffer.text()).toBe('ored!')
    buffer.replace('')
    expect(buffer.text()).toBe('')
  })
})

describe('OutputRate', () => {
  it('floods past the per-second limit and recovers in the next second', () => {
    const rate = new OutputRate(100)
    expect(rate.flooding(60, 0)).toBe(false)
    expect(rate.flooding(60, 500)).toBe(true)
    expect(rate.flooding(10, 999)).toBe(true)
    expect(rate.flooding(10, 1_000)).toBe(false)
  })
})
