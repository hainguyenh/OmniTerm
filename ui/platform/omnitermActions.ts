import { registerAction } from '../ide/platform/actions'
import { normalizeBinding, PRESETS, useKeymap, type Keymap } from '../ide/platform/keymap'

/** OmniTerm commands that run through a window event, and so can be started from the workbench too. */
export const OMNITERM_COMMAND_KEYS = [
  'newSession', 'newFolder', 'toggleSidebar', 'commandPalette', 'closeTab', 'agentQuota', 'newTempNote',
  'layout1', 'layout2', 'layout3', 'layout4', 'layout5', 'layout6', 'layout7', 'layout8',
] as const satisfies ReadonlyArray<keyof ShortcutBindings>

export type OmniTermShortcut = (typeof OMNITERM_COMMAND_KEYS)[number]

interface ActionInfo {
  title: string
  category: string
}

/** Titles of the OmniTerm commands as the workbench shows them in menus and Find Action. */
export const OMNITERM_ACTIONS: Readonly<Record<OmniTermShortcut, ActionInfo>> = {
  newSession: { title: 'New Session', category: 'Sessions' },
  newFolder: { title: 'New Folder', category: 'Workspace' },
  toggleSidebar: { title: 'Toggle Side Panel', category: 'View' },
  commandPalette: { title: 'Command Palette', category: 'Navigate' },
  closeTab: { title: 'Close Tab', category: 'Sessions' },
  agentQuota: { title: 'Agent Quota', category: 'Sessions' },
  newTempNote: { title: 'New Temporary Note', category: 'Workspace' },
  layout1: { title: 'Single Pane', category: 'Layout' },
  layout2: { title: '2 Panes', category: 'Layout' },
  layout3: { title: '1 + 2 Panes', category: 'Layout' },
  layout4: { title: '2 x 2 Grid', category: 'Layout' },
  layout5: { title: '3 x 2 Grid', category: 'Layout' },
  layout6: { title: '3 x 2 Grid (6 panes)', category: 'Layout' },
  layout7: { title: '4 x 2 Grid', category: 'Layout' },
  layout8: { title: '4 x 2 Grid (8 panes)', category: 'Layout' },
}

const COMMAND_EVENTS: Readonly<Record<Exclude<OmniTermShortcut, `layout${number}`>, string>> = {
  newSession: 'omniterm:new-session',
  newFolder: 'omniterm:new-folder',
  toggleSidebar: 'omniterm:toggle-sidebar',
  commandPalette: 'omniterm:command-palette',
  closeTab: 'omniterm:close-tab',
  agentQuota: 'omniterm:agent-quota',
  newTempNote: 'omniterm:new-temp-note',
}

/** Starts an OmniTerm command the same way its keyboard shortcut does: through its window event. */
export function runOmniTermCommand(key: OmniTermShortcut): void {
  if (key.startsWith('layout')) {
    window.dispatchEvent(new CustomEvent('omniterm:change-layout', { detail: { mode: Number(key.slice(6)) } }))
    return
  }
  window.dispatchEvent(new CustomEvent(COMMAND_EVENTS[key as keyof typeof COMMAND_EVENTS]))
}

export const omnitermActionId = (key: OmniTermShortcut): string => `omniterm.${key}`

/**
 * Keymap overrides that give OmniTerm's own shortcuts the keystrokes they have always had.
 *
 * Each OmniTerm command is bound to its configured shortcut. Any action of the workbench keymap that
 * used one of those keystrokes loses it, so one key press never means two things; the workbench
 * action stays reachable through its menu and Find Action. Actions the user already rebound are left
 * alone: that choice is theirs.
 */
export function omnitermKeymapOverrides(
  shortcuts: Partial<Record<OmniTermShortcut, string>>,
  preset: Keymap,
  userOverrides: Keymap = {},
): Keymap {
  const result: Keymap = {}
  const claimed = new Set<string>()
  for (const key of OMNITERM_COMMAND_KEYS) {
    const binding = shortcuts[key]?.trim()
    if (!binding) continue
    const id = omnitermActionId(key)
    if (id in userOverrides) continue
    result[id] = [binding]
    claimed.add(normalizeBinding(binding))
  }
  for (const [id, bindings] of Object.entries(preset)) {
    if (id in userOverrides || id in result) continue
    const kept = bindings.filter(binding => !claimed.has(normalizeBinding(binding)))
    if (kept.length !== bindings.length) result[id] = kept
  }
  return result
}

/**
 * Registers every OmniTerm command as a workbench action and applies the keymap overrides above.
 * Returns a disposer that removes the actions and restores the previous overrides.
 */
export function installOmniTermActions(
  shortcuts: Partial<Record<OmniTermShortcut, string>>,
  run: (key: OmniTermShortcut) => void = runOmniTermCommand,
): () => void {
  const disposers = OMNITERM_COMMAND_KEYS.map(key =>
    registerAction({
      id: omnitermActionId(key),
      title: OMNITERM_ACTIONS[key].title,
      category: OMNITERM_ACTIONS[key].category,
      verbatim: true,
      run: () => run(key),
    }),
  )
  const before = useKeymap.getState().overrides
  const applied = { ...before, ...omnitermKeymapOverrides(shortcuts, PRESETS[useKeymap.getState().preset] ?? {}, before) }
  useKeymap.setState({ overrides: applied })
  return () => {
    for (const dispose of disposers) dispose()
    // Only roll back if nobody changed the overrides since; otherwise their edit stands.
    if (useKeymap.getState().overrides === applied) useKeymap.setState({ overrides: before })
  }
}
