import { updateSource } from '../../ide/features/app/updates'
import { call, commands, type UpdateSource } from '../../ide/platform/ipc'
import { useProject } from '../../ide/platform/project'

/** The pre-setting storage of the update source; read once by the migration, then removed. */
const LEGACY_STORAGE_KEY = 'omniterm:update-source'

export type UpdateSourceChoice = 'auto' | UpdateSource

function isSource(value: unknown): value is UpdateSource {
  return value === 'github' || value === 'cnb'
}

/** The stored `general.updateSource` choice; `auto` while unset (the locale then decides). */
export function chosenUpdateSource(): UpdateSourceChoice {
  const chosen = useProject.getState().settings?.general?.updateSource
  return isSource(chosen) ? chosen : 'auto'
}

/** The source the updater uses: the setting, falling back to the default source. */
export function effectiveUpdateSource(): UpdateSource {
  return updateSource()
}

/** Saves `general.updateSource`; the change applies at once, even if writing the file fails. */
export async function saveUpdateSource(choice: UpdateSourceChoice): Promise<void> {
  const state = useProject.getState()
  if (state.settings) {
    useProject.setState({ settings: { ...state.settings, general: { ...state.settings.general, updateSource: choice } } })
  }
  try {
    useProject.setState({
      settings: await call(commands.settingsSet('global', 'general.updateSource', JSON.stringify(choice))),
    })
  } catch {
    /* the in-memory choice still applies */
  }
}

/**
 * Moves a value the old selector kept in localStorage into the setting, once, then drops the
 * key. An explicit choice already in the setting wins over the stale value.
 */
export async function migrateLegacyUpdateSource(): Promise<void> {
  let legacy: string | null = null
  try {
    if (typeof localStorage === 'undefined') return
    legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy === null) return
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    return
  }
  if (isSource(legacy) && chosenUpdateSource() === 'auto') await saveUpdateSource(legacy)
}
