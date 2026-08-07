/**
 * shellOptions.ts — the one list of local shells the UI may offer
 *
 * Four hardcoded copies of this list used to live in the renderer (the settings dropdown, the
 * new-session menu, the connection form, and a label map). Every one of them was Windows-shaped, so on
 * macOS and Linux the picker offered shells the backend rejects outright, and on Windows it offered
 * WSL whether or not WSL was installed plus a "Git Bash" entry that was never a real shell.
 *
 * The Tauri host answers `list_available_shells` by probing what actually resolves, so the list is
 * correct per machine, not per guess.
 */

import { diag } from './diag'

export type ShellOption = { id: string; label: string }

/** Fallback for hosts without the probe command. Mirrors the backend's ordering. */
export function staticShellOptions(platform: string): ShellOption[] {
  if (platform === 'win32') {
    return [
      { id: 'powershell', label: 'Windows PowerShell' },
      { id: 'cmd', label: 'Command Prompt' },
      { id: 'wsl', label: 'Windows Subsystem for Linux (WSL)' },
    ]
  }
  return [
    { id: 'default', label: 'Default login shell' },
    { id: 'zsh', label: 'Z shell' },
    { id: 'bash', label: 'Bash' },
    { id: 'sh', label: 'POSIX shell' },
  ]
}

/**
 * The shells this machine can actually start.
 *
 * Never resolves to an empty list: a probe that fails (or returns nothing) falls back to the static
 * list, because a picker with no options would leave the user unable to open a terminal at all.
 */
export async function loadShellOptions(): Promise<ShellOption[]> {
  const platform = window.omnitermAPI.app.platform
  try {
    const list = await window.omnitermAPI.shells.list()
    if (list?.length) return list
  } catch (e) {
    diag.warn('[shellOptions] could not probe available shells', e)
  }
  return staticShellOptions(platform)
}

/**
 * `requested` when it is still on offer, else the first option.
 *
 * Replaces `initialLocalShell`, which decided compatibility from a hardcoded per-OS set. A saved
 * connection can name a shell that has since been uninstalled — or one from the machine the backup
 * came from — and that must degrade to a working default rather than a spawn error.
 */
export function pickShell(options: ShellOption[], requested?: string): string {
  if (requested && options.some(o => o.id === requested)) return requested
  return options[0]?.id ?? 'default'
}

/** The label for `id`, falling back to the id itself so an unknown shell is still nameable. */
export function shellLabel(options: ShellOption[], id?: string): string {
  if (!id) return 'Local Terminal'
  return options.find(o => o.id === id)?.label ?? id
}
