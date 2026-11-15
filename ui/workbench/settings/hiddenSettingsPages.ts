import { useSettingsDialog } from '../../ide/features/settings/model/staging'
import { useSettingsPages } from '../../ide/workbench/contributions'

import { OMNITERM_SETTINGS_PAGES } from './settingsPageIds'

/**
 * Page ids that never apply to OmniTerm (JVM tooling; Go, PHP and Ruby, outside its TS, .NET, Rust
 * and Python focus) or that another page replaces; an entry also hides the pages below it.
 */
const HIDDEN_PAGES: readonly string[] = [
  'languages.java',
  'languages.kotlin',
  'languages.go',
  'languages.php',
  'languages.ruby',
  'build.gradle',
  'build.maven',
  // The deployment feature is not mounted, so its settings have nothing to drive.
  'build.deployment',
  // The IDE's updater page: OmniTerm's updater (Appearance & Behavior › Updates) ignores its options.
  'general.updates',
  // The terminal feature is not mounted: OmniTerm's own sessions are the terminal (Tools › Terminal).
  'tools.terminal',
]

/** Code Style and Color Scheme pages are minted per language; these are the hidden languages'. */
const HIDDEN_LANGUAGE_PAGES = new Set(['java', 'kotlin', 'groovy', 'scala', 'jvm-properties', 'go', 'php', 'ruby'])

/**
 * Where a link to a hidden page leads instead (Settings for New Projects… opens `languages.java`):
 * the page that took over its settings.
 */
const REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['languages.java', 'projectStructure'],
  ['languages.kotlin', 'projectStructure'],
  ['languages.go', 'projectStructure'],
  ['languages.php', 'projectStructure'],
  ['languages.ruby', 'projectStructure'],
  ['build.gradle', 'projectStructure'],
  ['build.maven', 'projectStructure'],
  ['general.updates', OMNITERM_SETTINGS_PAGES.about],
  ['tools.terminal', OMNITERM_SETTINGS_PAGES.terminal],
]

/** The page shown for a link to `id`: itself, or the replacement of a hidden page. */
export function settingsPageFor(id: string): string {
  return REPLACEMENTS.find(([hidden]) => id === hidden || id.startsWith(`${hidden}.`))?.[1] ?? id
}

export function isHiddenSettingsPage(id: string): boolean {
  if (HIDDEN_PAGES.some((hidden) => id === hidden || id.startsWith(`${hidden}.`))) return true
  const perLanguage = /^editor\.(?:codeStyle|colorScheme)\.([^.]+)$/.exec(id)
  return !!perLanguage && HIDDEN_LANGUAGE_PAGES.has(perLanguage[1]!)
}

/**
 * Keeps the Settings dialog free of pages for languages and tools OmniTerm does not cover. Upstream
 * registers its built-ins lazily (and the Code Style pages after a backend call), so this removes
 * them as they appear instead of once.
 */
export function hideInapplicableSettingsPages(): () => void {
  const prune = () => {
    const { pages } = useSettingsPages.getState()
    const doomed = [...pages.keys()].filter(isHiddenSettingsPage)
    if (doomed.length === 0) return
    const next = new Map(pages)
    for (const id of doomed) next.delete(id)
    useSettingsPages.setState({ pages: next })
  }
  // A link to a hidden page opens the page that replaced it.
  const redirect = () => {
    const { pageId } = useSettingsDialog.getState()
    const target = pageId ? settingsPageFor(pageId) : pageId
    if (target !== pageId) useSettingsDialog.setState({ pageId: target })
  }
  prune()
  redirect()
  const disposers = [useSettingsPages.subscribe(prune), useSettingsDialog.subscribe(redirect)]
  return () => disposers.forEach((dispose) => dispose())
}
