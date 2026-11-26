import type { ThemeChoice } from '../../ide/platform/themes'

import type { PopupEntry } from './TitlePopupList'

/**
 * The theme picker's rows: dark themes, then light ones, each section under its own caption and each
 * kind sorted by name; the theme in effect is checked.
 */
export function themePopupEntries(
  choices: readonly ThemeChoice[],
  current: string,
  select: (id: ThemeChoice['id']) => void,
): PopupEntry[] {
  const entries: PopupEntry[] = []
  for (const kind of ['dark', 'light'] as const) {
    const group = choices.filter((choice) => choice.kind === kind).sort((a, b) => a.label.localeCompare(b.label))
    group.forEach((choice, index) => {
      entries.push({
        id: `theme:${choice.id}`,
        label: choice.label,
        detail: choice.origin,
        checked: choice.id === current,
        ...(index === 0 ? { header: kind === 'dark' ? 'Dark themes' : 'Light themes' } : {}),
        run: () => select(choice.id),
      })
    })
  }
  return entries
}
