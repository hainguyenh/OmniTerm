import { describe, expect, it } from 'vitest'

import { exitBannerText } from '../exitBanner'

const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

describe('exitBannerText', () => {
  it('names the exit code and the two keys on a line of its own', () => {
    const text = exitBannerText(130)
    expect(plain(text)).toBe('\r\n[process exited (code 130) — press Enter to restart, Ctrl+C again to close]\r\n')
  })

  it('draws the line in the warning colour with the keys in bold and resets after it', () => {
    const text = exitBannerText(0)
    expect(text).toContain('\u001b[33m[process exited')
    expect(text).toContain('\u001b[1mEnter\u001b[22m')
    expect(text).toContain('\u001b[1mCtrl+C\u001b[22m')
    expect(text.trimEnd().endsWith('\u001b[0m')).toBe(true)
  })
})
