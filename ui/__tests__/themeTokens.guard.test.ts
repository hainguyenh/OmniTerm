import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const UI_ROOT = join(__dirname, '..')

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') continue
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.(css|tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(path)
  }
  return out
}

const files = sources(UI_ROOT).map((path) => ({ path, text: readFileSync(path, 'utf8') }))

describe('theme tokens', () => {
  it('declares every custom property that is read without a fallback', () => {
    const declared = new Set<string>()
    for (const { text } of files) {
      for (const match of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(match[1])
      for (const match of text.matchAll(/['"`](--[a-zA-Z0-9-]+)['"`]/g)) declared.add(match[1])
    }
    const missing = new Set<string>()
    for (const { path, text } of files) {
      for (const match of text.matchAll(/var\((--[a-zA-Z0-9-]+)\s*\)/g)) {
        // Inline `--tree-depth` style props are set per element at runtime.
        if (!declared.has(match[1])) missing.add(`${match[1]} (${path.slice(UI_ROOT.length + 1)})`)
      }
    }
    expect([...missing].filter((item) => !item.startsWith('--tree-depth'))).toEqual([])
  })

  it('keeps white-based hovers and white text off the themed app chrome', () => {
    const offenders = files
      .filter(({ path }) => /(components|features|workbench)/.test(path.split(sep).join('/')) && path.endsWith('.tsx'))
      .filter(({ text }) => /hover:bg-white\/|\bbg-white\/\d|\bbg-black\/10|hover:text-white/.test(text))
      .map(({ path }) => path.slice(UI_ROOT.length + 1))
    // White on a light theme's background is unreadable; use theme-hover / theme-fg tokens.
    expect(offenders).toEqual([])
  })
})
