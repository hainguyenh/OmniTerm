/**
 * OmniTerm: the simple view of the Settings tree. It lists only the pages an everyday user needs;
 * every other page keeps its default (or whatever was set before) and stays reachable through the
 * search, a link to it, or the full view. Which pages are simple is the host's policy
 * (`setSimplePages`); without one the dialog has no simple view.
 */
import { create } from "zustand";
import type { PageNode } from "./pages";

const STORAGE_KEY = "omniterm.settings.simpleView";

function stored(): boolean {
  try {
    // Simple unless the user chose the full view.
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export const useSimpleView = create<{ simple: boolean }>(() => ({ simple: stored() }));

export function setSimpleView(simple: boolean): void {
  useSimpleView.setState({ simple });
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, simple ? "1" : "0");
  } catch {
    // The choice then lasts for this window only.
  }
}

export type SimplePages = (pageId: string) => boolean;

let simplePages: SimplePages | null = null;

/** Sets which pages the simple view lists; returns a disposer restoring none. */
export function setSimplePages(isSimple: SimplePages): () => void {
  simplePages = isSimple;
  return () => {
    if (simplePages === isSimple) simplePages = null;
  };
}

/** Whether a host defined a simple view (the dialog offers the switch only then). */
export function hasSimpleView(): boolean {
  return simplePages !== null;
}

/**
 * The tree reduced to the simple pages and the folders and parents leading to them. `keep` (the
 * page being shown, e.g. one a link opened) stays listed whatever it is.
 */
export function simplePageTree(nodes: readonly PageNode[], keep?: string): PageNode[] {
  const isSimple = simplePages;
  if (!isSimple) return [...nodes];
  const out: PageNode[] = [];
  for (const node of nodes) {
    const children = simplePageTree(node.children, keep);
    const self = !!node.page && (node.key === keep || isSimple(node.page.id));
    if (self || children.length) out.push({ ...node, children });
  }
  return out;
}
