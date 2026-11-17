import { useSettingsDialog } from '../../ide/features/settings/model/staging'
import { disabledFamilies, languageFamiliesOf } from '../../ide/platform/languageFamilies'
import { useProject } from '../../ide/platform/project'
import { useSettingsPages } from '../../ide/workbench/contributions'

import { OMNITERM_SETTINGS_PAGES } from './settingsPageIds'

/** Settings › Code › Languages: where a language family is switched on and off. */
const LANGUAGES_PAGE = 'languages.enabled'

/** Page ids that never apply to OmniTerm or that another page replaces; an entry also hides the pages below it. */
const REMOVED_PAGES: readonly string[] = [
  // The deployment feature is not mounted, so its settings have nothing to drive.
  'build.deployment',
  // The IDE's updater page: OmniTerm's updater (Updates) ignores its options.
  'general.updates',
  // The terminal feature is not mounted: OmniTerm's own sessions are the terminal (Terminal).
  'tools.terminal',
]

/** Where a link to a removed page leads instead: the page that took over its settings. */
const REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['general.updates', OMNITERM_SETTINGS_PAGES.about],
  ['tools.terminal', OMNITERM_SETTINGS_PAGES.terminal],
]

/** Code Style and Color Scheme page names of the JVM that are not language ids. */
const EXTRA_LANGUAGE_PAGES: Readonly<Record<string, readonly string[]>> = {
  java: ['jvm-properties'],
}

const covers = (entries: readonly string[], id: string): boolean =>
  entries.some((entry) => id === entry || id.startsWith(`${entry}.`))

interface OffLanguages {
  pages: readonly string[]
  languages: ReadonlySet<string>
}

let cached: { settings: unknown; off: OffLanguages } | null = null

/** The pages and languages of the families switched off in the current settings. */
function offLanguages(): OffLanguages {
  const settings = useProject.getState().settings
  if (cached?.settings !== settings) {
    const families = disabledFamilies(languageFamiliesOf(settings))
    cached = {
      settings,
      off: {
        pages: families.flatMap((family) => family.pages),
        languages: new Set(families.flatMap((family) => [...family.languages, ...(EXTRA_LANGUAGE_PAGES[family.name] ?? [])])),
      },
    }
  }
  return cached.off
}

/** A page of a language family that is switched off: its own pages, its Code Style and Color Scheme. */
export function isOffLanguagePage(id: string): boolean {
  const off = offLanguages()
  if (covers(off.pages, id)) return true
  const perLanguage = /^editor\.(?:codeStyle|colorScheme)\.([^.]+)$/.exec(id)
  return !!perLanguage && off.languages.has(perLanguage[1]!)
}

const isRemovedPage = (id: string): boolean => covers(REMOVED_PAGES, id)

/** The page shown for a link to `id`: itself, the replacement of a removed page, or the Languages page. */
export function settingsPageFor(id: string): string {
  const replaced = REPLACEMENTS.find(([removed]) => id === removed || id.startsWith(`${removed}.`))?.[1]
  if (replaced) return replaced
  return isOffLanguagePage(id) ? LANGUAGES_PAGE : id
}

export function isHiddenSettingsPage(id: string): boolean {
  return isRemovedPage(id) || isOffLanguagePage(id)
}

/**
 * Keeps the Settings dialog free of the pages OmniTerm does not cover. Upstream registers its
 * built-ins lazily (and the Code Style pages after a backend call), so the removed ones are dropped
 * as they appear instead of once. The pages of a language family that is switched off stay
 * registered (`settingsLayout.ts` leaves them out of the tree), so switching it on shows them again.
 */
export function hideInapplicableSettingsPages(): () => void {
  const prune = () => {
    const { pages } = useSettingsPages.getState()
    const doomed = [...pages.keys()].filter(isRemovedPage)
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
  // The tree is built from the page list: hand it a new one when a family was switched.
  const refresh = (settings: unknown, previous: unknown) => {
    if (settings === previous) return
    const before = cached?.off
    if (offLanguages() === before) return
    useSettingsPages.setState({ pages: new Map(useSettingsPages.getState().pages) })
  }
  prune()
  redirect()
  const disposers = [
    useSettingsPages.subscribe(prune),
    useSettingsDialog.subscribe(redirect),
    useProject.subscribe((state, previous) => refresh(state.settings, previous.settings)),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
