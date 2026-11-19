import { create } from "zustand";

/** What the shell does with a project root it manages (OmniTerm workspace folders). */
export interface RootActions {
  /** Switches the project on or off. */
  toggle: (path: string) => void;
  /** Makes it the workspace's default project (where new terminals and agents start). */
  setDefault: (path: string) => void;
  /** Opens a terminal in the project folder. */
  openTerminal: (path: string) => void;
}

interface RootToggleState {
  /** Comparable root path -> whether the project is switched on. A root absent here has no checkbox. */
  checked: ReadonlyMap<string, boolean>;
  /** Comparable path of the default project, or null when none is marked. */
  defaultKey: string | null;
  actions: RootActions | null;
}

const useRootToggles = create<RootToggleState>(() => ({ checked: new Map(), defaultKey: null, actions: null }));

/** Key form used on both sides: forward slashes, no trailing slash, lower case on Windows drives. */
export function rootToggleKey(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

/**
 * Installs the roots the shell manages: their on/off state, the default project and what the
 * row's controls do. Call with an empty map and null actions to remove them all.
 */
export function setRootToggles(
  checked: ReadonlyMap<string, boolean>,
  actions: RootActions | null,
  defaultPath: string | null = null,
): void {
  useRootToggles.setState({ checked, actions, defaultKey: defaultPath ? rootToggleKey(defaultPath) : null });
}

/** The checkbox state of the project root at `path`: undefined when its row has none. */
export function useRootChecked(path: string): { checked: boolean; toggle: () => void } | undefined {
  const checked = useRootToggles((s) => s.checked.get(rootToggleKey(path)));
  const actions = useRootToggles((s) => s.actions);
  return checked === undefined || !actions ? undefined : { checked, toggle: () => actions.toggle(path) };
}

export interface ManagedRoot {
  /** Switched on (part of what search, scans and the panel work with). */
  active: boolean;
  /** The workspace's default project. */
  isDefault: boolean;
  setDefault: () => void;
  openTerminal: () => void;
}

/** The shell's state of the project root at `path`: undefined for a root it does not manage. */
export function useManagedRoot(path: string): ManagedRoot | undefined {
  const key = rootToggleKey(path);
  const checked = useRootToggles((s) => s.checked.get(key));
  const isDefault = useRootToggles((s) => s.defaultKey === key);
  const actions = useRootToggles((s) => s.actions);
  if (checked === undefined || !actions) return undefined;
  return {
    active: checked,
    isDefault,
    setDefault: () => actions.setDefault(path),
    openTerminal: () => actions.openTerminal(path),
  };
}

/** Whether the project root at `path` is the workspace's default project (outside React). */
export function isDefaultRoot(path: string): boolean {
  return useRootToggles.getState().defaultKey === rootToggleKey(path);
}
