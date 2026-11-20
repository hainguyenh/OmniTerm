import { AboutOverlay } from '../ide/features/app/AboutDialog'
import { appActions } from '../ide/features/app/appActions'
import { InvalidateCachesOverlay, registerInvalidateCachesActions } from '../ide/features/app/InvalidateCaches'
import { KeymapReferenceOverlay } from '../ide/features/app/KeymapReference'
import { installLocaleSync, registerLocalizedActions } from '../ide/features/app/locale'
import { TerminationOverlay } from '../ide/features/app/termination'
import { registerOverlay } from '../ide/workbench/contributions'

/**
 * The parts of the IDE `app` feature that fit OmniTerm's shell: UI locale, the Help and Edit
 * actions, About, the keymap reference, Invalidate Caches and the termination prompt.
 *
 * Left out on purpose, because OmniTerm's shell owns them: project windows and workspaces
 * (`windowActions`, `projectActions`, launch handling, window groups, New Project, the workspace
 * dialog), the window title, the close guard, the native menu bridge and the updater, which
 * `ui/workbench/updater` replaces.
 */
export function activateAppFeature(): () => void {
  const disposers = [
    installLocaleSync(),
    registerLocalizedActions(appActions),
    registerOverlay({ id: 'app.about', component: AboutOverlay }),
    registerOverlay({ id: 'app.keymapReference', component: KeymapReferenceOverlay }),
    registerOverlay({ id: 'app.invalidateCaches', component: InvalidateCachesOverlay }),
    registerOverlay({ id: 'app.termination', component: TerminationOverlay }),
    registerInvalidateCachesActions(),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
