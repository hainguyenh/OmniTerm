import type { AppTheme } from '../themes'
import type { TerminalToolbarActions } from '../terminalToolbar'
import type { SessionControlAppearance } from './SessionControlButtons'

interface TerminalAppearanceTarget {
  id: string
  connId: string
}

interface CreateTerminalAppearanceArgs {
  themes: AppTheme[]
  appSettings: AppSettings
  resolved?: TerminalAppearance
  target: TerminalAppearanceTarget
  onThemeApply?: (themeId: string, target: TerminalAppearanceTarget) => void
  onFontSizeChange?: (delta: number, target: TerminalAppearanceTarget) => void
  onToolbarActionsChange?: (actions: TerminalToolbarActions, target: TerminalAppearanceTarget) => void
}

export function createTerminalAppearance({
  themes, appSettings, resolved, target, onThemeApply, onFontSizeChange, onToolbarActionsChange,
}: CreateTerminalAppearanceArgs): SessionControlAppearance | undefined {
  if (!onThemeApply || !onFontSizeChange) return undefined
  return {
    themes,
    themeId: resolved?.themeId ?? appSettings.themeId,
    fontSize: resolved?.fontSize ?? appSettings.fontSize,
    darkMode: appSettings.darkMode,
    onThemeApply: (themeId: string) => onThemeApply(themeId, target),
    onFontSizeChange: (delta: number) => onFontSizeChange(delta, target),
    headerActions: resolved?.toolbarActions?.header,
    footerActions: resolved?.toolbarActions?.footer,
    onToolbarActionsChange: onToolbarActionsChange
      ? (actions: TerminalToolbarActions) => onToolbarActionsChange(actions, target)
      : undefined,
    scopeLabel: 'this terminal',
    buttonTitle: 'Appearance for this terminal',
  }
}
