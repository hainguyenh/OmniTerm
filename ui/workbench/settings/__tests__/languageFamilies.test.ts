import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  disabledFamilies,
  LANGUAGE_FAMILIES,
  languageFamiliesOf,
  resolveLanguageFamilies,
} from '../../../ide/platform/languageFamilies'
import { validateLanguages } from '../../../ide/platform/languageSettings'

const RUST_SETTINGS = fileURLToPath(new URL('../../../../crates/ide-core/src/settings.rs', import.meta.url))

/** `LANGUAGE_FAMILIES` as the backend declares it: name, language ids, default. */
function backendFamilies(): Array<{ name: string; languages: string[]; enabled: boolean }> {
  const source = readFileSync(RUST_SETTINGS, 'utf8')
  const start = source.indexOf('pub const LANGUAGE_FAMILIES')
  const table = source.slice(start, source.indexOf('];', start))
  return [...table.matchAll(/\("([\w-]+)", &\[([^\]]*)\], (true|false)\)/g)].map((row) => ({
    name: row[1]!,
    languages: [...row[2]!.matchAll(/"([^"]+)"/g)].map((id) => id[1]!),
    enabled: row[3] === 'true',
  }))
}

describe('language families', () => {
  it('match the backend list, so both sides switch the same languages', () => {
    const backend = backendFamilies()
    expect(backend.length).toBeGreaterThan(0)
    expect(LANGUAGE_FAMILIES.map(({ name, languages, enabled }) => ({ name, languages: [...languages], enabled })))
      .toEqual(backend)
  })

  it('leave the JVM, Go, PHP and Ruby off until asked for', () => {
    const families = resolveLanguageFamilies(undefined)
    expect(families).toMatchObject({ typescript: true, python: true, rust: true, java: false, go: false, php: false, ruby: false })
    expect(disabledFamilies(families).map((family) => family.name)).toEqual(['java', 'go', 'php', 'ruby'])
  })

  it('follow the settings entry and ignore anything that is not a switch', () => {
    const settings = { languages: { families: { java: true, python: false, rust: 'no', unknown: false } } }
    expect(languageFamiliesOf(settings)).toMatchObject({ java: true, python: false, rust: true })
    expect(languageFamiliesOf(settings)).not.toHaveProperty('unknown')
    expect(languageFamiliesOf(null)).toEqual(resolveLanguageFamilies(undefined))
  })

  it('are part of the validated settings, so the Languages page shows each switch with its default', () => {
    expect(validateLanguages(undefined).families).toEqual(resolveLanguageFamilies(undefined))
    expect(validateLanguages({ families: { go: true } }).families.go).toBe(true)
  })
})
