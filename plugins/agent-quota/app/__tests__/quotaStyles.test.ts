import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const css = (file: string) => fs.readFileSync(path.join(APP, file), 'utf8')
/** The declarations of the first rule for `selector` (no nested braces in these files' rules). */
const rule = (source: string, selector: string): string => {
  const start = source.indexOf(`${selector} {`)
  expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0)
  return source.slice(start, source.indexOf('}', start))
}

describe('agent quota styles', () => {
  it('draws the unused track from the theme, not a fixed near-black (light-mode regression)', () => {
    const lines = css('agentQuota.css')
    expect(lines).toMatch(/--aq-track-bg:\s*color-mix\(in srgb, var\(--theme-bg\)/)
    expect(rule(lines, '.aq-track')).toContain('background: var(--aq-track-bg)')
    expect(rule(css('profilesDashboard.css'), '.aq-pd-bar')).toContain('background: var(--aq-track-bg)')
    expect(lines + css('profilesDashboard.css')).not.toContain('#15161e')
  })

  it('gives every quota line of a strip the same columns', () => {
    const lines = css('agentQuota.css')
    expect(rule(lines, '.aq-lines')).toContain('display: grid')
    expect(rule(lines, '.aq-line')).toContain('grid-template-columns: subgrid')
    expect(rule(lines, '.aq-line')).toContain('grid-column: 1 / -1')
  })

  it('paints the profiles dialog with a theme colour that exists', () => {
    expect(rule(css('profilesDashboard.css'), '.aq-pd-dialog')).toContain('background: var(--theme-popup-bg')
  })

  it('draws the horse and the airplane twice as large and every tier at half its former speed', () => {
    const art = css('headerBusyArt.css')
    for (const tier of ['onTrack', 'fast']) expect(rule(art, `.aq-busy-art-${tier}`)).toContain('--aq-art-tier-scale: 2')
    const travel = (tier: string) => rule(art, `.aq-busy-art-${tier}`).match(/--aq-art-travel:\s*([\d.]+)s/)?.[1]
    expect([travel('slow'), travel('onTrack'), travel('fast'), travel('overshooting')]).toEqual(['28', '18', '12', '7.6'])
    expect(rule(art, '.aq-busy-art > img')).toContain('pointer-events: none')
  })
})
