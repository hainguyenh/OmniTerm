/**
 * Longer explanations for keyboard shortcuts whose effect is not obvious from their name, shown
 * under the binding in Settings → Keyboard Shortcuts. Most shortcuts need none.
 */
export const SHORTCUT_DESCRIPTIONS: Partial<Record<keyof ShortcutBindings, string>> = {
  pasteScript: 'Pastes the clipboard into a local PowerShell pane as a single script block, so nothing runs until you press Enter. An accent bar marks the block until it runs, the lines OmniTerm adds are tagged # >>> / # OmniTerm / # <<<, and when it runs, an ========== Output ========== divider separates the script from its results. Anywhere else (cmd, WSL, SSH, an AI agent) it does an ordinary paste.',
  agentQuota: 'Opens the Agent Quota quick settings for the focused terminal.',
}
