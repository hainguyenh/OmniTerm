import { create } from 'zustand'

import { resolveTokenColor, toHex } from '../../ide/platform/cssColor'
import { useProject } from '../../ide/platform/project'
import { addContributedTheme, baseTheme, isThemeChoiceId, type ThemeChoiceId } from '../../ide/platform/themes'
import {
  DEFAULT_ACCENT,
  applyThemeAttributes,
  prefersLight,
  resolveThemeChoice,
  setTheme,
  subscribeScheme,
  syncWindowBackground,
  useThemeOverride,
} from '../../ide/workbench/theme'
import type { AppTheme } from '../../themes'
import { TOKYO_NIGHT } from '../../themes'
import { diag } from '../../diag'
import { applyThemeVars, isSquareTheme, themeCssVars } from '../../utils/themeVars'

import { isSafeThemeId, omniChoiceId, parseOmniChoice, WORKBENCH_THEME_ID, type ThemeMode } from './choice'
import { omniPaletteCss } from './palette'
import { appThemeFromTokens } from './workbenchTheme'

/**
 * One theme for every window. The workbench's `appearance.theme` setting is the single source of
 * truth: its pickers (gear menu, Settings > Appearance, Quick Switch) list the workbench's own
 * themes and OmniTerm's (as `plugin:omniterm/<id>@<mode>`), and this module applies whichever is
 * selected to the document: the tokens.css palette (workbench chrome, editor, syntax), OmniTerm's
 * `--theme-*` variables, and the OmniTerm theme terminals paint from. Everything is CSS variables
 * and attributes on the root element, so a switch repaints in place and never re-creates a terminal.
 */

const STYLE_ID = 'omniterm-theme-palette'
const LEGACY_ACCENT = '#8fa5d6'
const ACCENT_RE = /^#[0-9a-f]{3,8}$/i

interface UnifiedState {
  /** The picker value in effect. */
  choice: ThemeChoiceId
  mode: ThemeMode
  /** Id of the OmniTerm theme terminals use: an OmniTerm theme, or `workbench`. */
  themeId: string
  /** The OmniTerm theme in effect (the selected one, or the one derived from the workbench tokens). */
  appTheme: AppTheme
}

export const useUnifiedTheme = create<UnifiedState>(() => ({
  choice: 'dark',
  mode: 'dark',
  themeId: TOKYO_NIGHT.id,
  appTheme: TOKYO_NIGHT,
}))

let omniThemes: AppTheme[] = []
let themesLoaded = false
let fallbackChoice: () => string | undefined = () => undefined
let disposeChoices: Array<() => void> = []
let appliedVarKeys: string[] = []

/** Offers each OmniTerm theme, in both modes, to every theme picker of this window. */
function registerChoices(): void {
  for (const dispose of disposeChoices) dispose()
  disposeChoices = []
  for (const theme of omniThemes) {
    if (!isSafeThemeId(theme.id)) continue
    for (const mode of ['dark', 'light'] as const) {
      disposeChoices.push(
        addContributedTheme({
          id: omniChoiceId(theme.id, mode),
          label: `${String(theme.name || theme.id).slice(0, 60)} (${mode === 'dark' ? 'Dark' : 'Light'})`,
          kind: mode,
          origin: 'OmniTerm',
        }),
      )
    }
  }
}

/** The picker value selected for this window. */
function currentChoice(): ThemeChoiceId {
  const override = useThemeOverride.getState().theme
  if (override) return resolveThemeChoice({ theme: override }, prefersLight())
  const appearance = useProject.getState().settings?.appearance
  if (appearance) return resolveThemeChoice(appearance, prefersLight())
  // Settings not read yet (or a window without the IDE backend): the cached theme the main window keeps.
  const cachedTheme = fallbackChoice()
  return isThemeChoiceId(cachedTheme) ? cachedTheme : 'dark'
}

const readToken = (name: string): string | null => {
  const color = resolveTokenColor(name)
  return color ? toHex(color) : null
}

function applyAccent(): void {
  const root = document.documentElement
  const accent = useProject.getState().settings?.appearance?.accent
  const custom =
    typeof accent === 'string' && ACCENT_RE.test(accent) && ![DEFAULT_ACCENT, LEGACY_ACCENT].includes(accent.toLowerCase())
  if (custom) root.style.setProperty('--accent', accent)
  else root.style.removeProperty('--accent')
}

function writePalette(css: string | null): void {
  let style = document.getElementById(STYLE_ID)
  if (!css) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css
}

/** Applies the selected theme to this window's document and publishes it to `useUnifiedTheme`. */
export function applyUnifiedTheme(): void {
  try {
    applyUnchecked()
  } catch (error) {
    diag.warn('[theme] could not apply the selected theme', error)
  }
}

function applyUnchecked(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const choice = currentChoice()
  const omni = parseOmniChoice(choice)
  const selected = omni ? omniThemes.find((t) => t.id === omni.themeId) : undefined
  // The list of themes arrives asynchronously; keep what is shown until the named theme is known.
  if (omni && !selected && !themesLoaded) return

  if (omni && selected) {
    writePalette(omniPaletteCss(selected, omni.mode))
    root.dataset.omniThemeKind = omni.mode
  } else {
    writePalette(null)
    delete root.dataset.omniThemeKind
  }
  applyThemeAttributes(baseTheme(choice, omni?.mode ?? 'light'), root)
  applyAccent()

  const mode: ThemeMode = root.dataset.theme === 'light' ? 'light' : 'dark'
  const appTheme = selected ?? appThemeFromTokens(readToken, mode)
  const vars = themeCssVars(appTheme, mode)
  applyThemeVars(root, vars)
  for (const key of appliedVarKeys) if (!(key in vars)) root.style.removeProperty(key)
  appliedVarKeys = Object.keys(vars)
  root.classList.toggle('theme-square', !!selected && isSquareTheme(selected))
  syncWindowBackground()

  const prev = useUnifiedTheme.getState()
  if (prev.choice !== choice || prev.mode !== mode || prev.appTheme !== appTheme) {
    useUnifiedTheme.setState({ choice, mode, themeId: selected?.id ?? WORKBENCH_THEME_ID, appTheme })
  }
}

/** The OmniTerm themes that exist (the backend list); re-registers the picker entries and re-applies. */
export function setOmniThemes(themes: AppTheme[]): void {
  omniThemes = themes
  themesLoaded = true
  try {
    registerChoices()
  } catch (error) {
    diag.warn('[theme] could not offer the OmniTerm themes', error)
  }
  applyUnifiedTheme()
}

/**
 * Starts applying the selected theme in this window and keeps doing so as the setting, the OS mode
 * or the theme list changes. `fallback` names the choice to show before the settings are read.
 */
export function installUnifiedTheme(fallback: () => string | undefined = () => undefined): () => void {
  fallbackChoice = fallback
  applyUnifiedTheme()
  const off = [
    useProject.subscribe((s, prev) => {
      if (s.settings?.appearance !== prev.settings?.appearance) applyUnifiedTheme()
    }),
    useThemeOverride.subscribe(applyUnifiedTheme),
    subscribeScheme(applyUnifiedTheme),
  ]
  return () => {
    off.forEach((o) => o())
    for (const dispose of disposeChoices) dispose()
    disposeChoices = []
  }
}

/** Re-applies after the shared theme a window without the IDE backend follows changed. */
export const refreshUnifiedTheme = applyUnifiedTheme

/** Selects OmniTerm theme `themeId` in `mode` (or, for the workbench theme, its plain light / dark). */
export function selectOmniTheme(themeId: string, mode: ThemeMode): Promise<void> {
  return setTheme(themeId === WORKBENCH_THEME_ID || !isSafeThemeId(themeId) ? mode : omniChoiceId(themeId, mode))
}

/** Flips light / dark, keeping the OmniTerm palette when one is selected. */
export function toggleThemeMode(): Promise<void> {
  const { choice, mode } = useUnifiedTheme.getState()
  const next: ThemeMode = mode === 'dark' ? 'light' : 'dark'
  const omni = parseOmniChoice(choice)
  return setTheme(omni ? omniChoiceId(omni.themeId, next) : next)
}
