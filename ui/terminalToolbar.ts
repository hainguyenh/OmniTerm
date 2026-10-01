export type TerminalToolbarAction =
  | 'theme'
  | 'detach'
  | 'fullscreen'
  | 'fontSize'
  | 'stop'
  | 'clear'
  | 'copy'
  | 'save'

export interface TerminalToolbarActions {
  header?: TerminalToolbarAction[]
  footer?: TerminalToolbarAction[]
}

export const DEFAULT_HEADER_ACTIONS: readonly TerminalToolbarAction[] = [
  'theme',
  'detach',
  'fullscreen',
]

/** Copy stays opt-in (Customize terminal actions): Save covers exporting output by default. */
export const DEFAULT_FOOTER_ACTIONS: readonly TerminalToolbarAction[] = [
  'fontSize',
  'stop',
  'clear',
  'save',
]

export const HEADER_ACTION_OPTIONS: readonly TerminalToolbarAction[] = [
  'theme',
  'detach',
  'fullscreen',
]

export const FOOTER_ACTION_OPTIONS: readonly TerminalToolbarAction[] = [
  'fontSize',
  'stop',
  'clear',
  'copy',
  'save',
]

export const TERMINAL_ACTION_LABELS: Record<TerminalToolbarAction, string> = {
  theme: 'Theme',
  detach: 'Detach terminal',
  fullscreen: 'Focus pane full screen',
  fontSize: 'Font size',
  stop: 'Stop current process',
  clear: 'Clear terminal',
  copy: 'Copy terminal output',
  save: 'Save output to file',
}

export function normalizeToolbarActions(
  value: unknown,
  allowed: readonly TerminalToolbarAction[],
  fallback: readonly TerminalToolbarAction[],
): TerminalToolbarAction[] {
  if (!Array.isArray(value)) return [...fallback]
  const allowedSet = new Set(allowed)
  const result: TerminalToolbarAction[] = []
  for (const item of value) {
    if (typeof item === 'string' && allowedSet.has(item as TerminalToolbarAction)) {
      const action = item as TerminalToolbarAction
      if (!result.includes(action)) result.push(action)
    }
  }
  return result
}

export function toolbarActionsFor(
  actions: TerminalToolbarActions | undefined,
  surface: 'header' | 'footer',
): TerminalToolbarAction[] {
  return normalizeToolbarActions(
    surface === 'header' ? actions?.header : actions?.footer,
    surface === 'header' ? HEADER_ACTION_OPTIONS : FOOTER_ACTION_OPTIONS,
    surface === 'header' ? DEFAULT_HEADER_ACTIONS : DEFAULT_FOOTER_ACTIONS,
  )
}
