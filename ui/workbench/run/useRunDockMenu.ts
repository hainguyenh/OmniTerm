import { setRunHeaderAlways, useRunHeaderPref } from '../../ide/features/run/headerPref'
import type { MenuItem } from '../../ide/ui/Menu'

/** The Run tool window's "⋮" entries: whether the title bar keeps its Run widget while idle. */
export function useRunDockMenu(): MenuItem[] {
  const always = useRunHeaderPref((s) => s.always)
  return [
    {
      label: 'Always Show Run Widget in Title Bar',
      checked: always,
      run: () => setRunHeaderAlways(!always),
    },
    { kind: 'separator' },
    { kind: 'action', action: 'run.editConfigs' },
  ]
}
