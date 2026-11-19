import { create } from "zustand";

interface RootToggleState {
  /** Comparable root path -> whether the project is switched on. A root absent here has no checkbox. */
  checked: ReadonlyMap<string, boolean>;
  toggle: ((path: string) => void) | null;
}

const useRootToggles = create<RootToggleState>(() => ({ checked: new Map(), toggle: null }));

/** Key form used on both sides: forward slashes, no trailing slash, lower case on Windows drives. */
export function rootToggleKey(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

/** Installs the roots that get an active checkbox; call with an empty map to remove them all. */
export function setRootToggles(checked: ReadonlyMap<string, boolean>, toggle: ((path: string) => void) | null): void {
  useRootToggles.setState({ checked, toggle });
}

/** The checkbox state of the project root at `path`: undefined when its row has none. */
export function useRootChecked(path: string): { checked: boolean; toggle: () => void } | undefined {
  const checked = useRootToggles((s) => s.checked.get(rootToggleKey(path)));
  const toggle = useRootToggles((s) => s.toggle);
  return checked === undefined || !toggle ? undefined : { checked, toggle: () => toggle(path) };
}
