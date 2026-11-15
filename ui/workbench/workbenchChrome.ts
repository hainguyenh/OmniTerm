import { useProject } from '../ide/platform/project'

/**
 * The parts of the IDE `Workbench` frame that OmniTerm's shell mounts too: View › Appearance
 * switches and the workbench banners (Restricted Mode with its Trust Project button, plugin and
 * tool notices). `Workbench.tsx` keeps these private, so they are restated here with the
 * same settings keys and defaults.
 */

/** `appearance.showMainToolbar` / `appearance.showStatusBar`, shown unless switched off. */
export function useAppearanceFlag(key: 'showMainToolbar' | 'showStatusBar'): boolean {
  return useProject((s) => s.settings?.appearance?.[key] !== false)
}

export type NavigationBarPosition = 'top' | 'statusBar' | 'hidden'

/** Where View › Appearance › Navigation Bar puts the breadcrumbs; the backend default is the status bar. */
export function useNavigationBarPosition(): NavigationBarPosition {
  const position = useProject((s) => s.settings?.appearance?.navigationBar)
  return position === 'top' || position === 'statusBar' || position === 'hidden' ? position : 'statusBar'
}
