import type { WorkspaceColor, WorkspaceIcon } from '@omniterm/contract'

export const WORKSPACE_COLORS: readonly WorkspaceColor[] = [
  'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray',
]

export const WORKSPACE_ICONS: readonly WorkspaceIcon[] = [
  'folder', 'briefcase', 'layers', 'code', 'server', 'star',
]

export const WORKSPACE_COLOR_VALUES: Record<WorkspaceColor, string> = {
  red: '#f87171',
  orange: '#fb923c',
  yellow: '#facc15',
  green: '#4ade80',
  blue: '#60a5fa',
  purple: '#c084fc',
  pink: '#f472b6',
  gray: '#9ca3af',
}
