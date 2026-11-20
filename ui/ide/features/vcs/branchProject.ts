/**
 * The project the user chose in the Branches popup's project list: the title bar's branch widget
 * shows its repository, and branch operations act on it. A choice holds while the default project
 * it was made against stays the default; another default project shows that one again.
 */
import { create } from "zustand";
import { useVcs } from "./store";

const COLLAPSED_KEY = "omniterm.vcs.branchProjectsCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

interface BranchProject {
  /** The chosen repository root (`null`: none; the widget follows the active file). */
  root: string | null;
  /** The default project's repository when the choice was made. */
  against: string | null;
  /** The project list is folded to its header (remembered). */
  collapsed: boolean;
}

export const useBranchProject = create<BranchProject>(() => ({ root: null, against: null, collapsed: readCollapsed() }));

/**
 * Chooses `root` while `defaultRepo` is the default project's repository. Choosing the default
 * project is a choice too: the widget then stays on it rather than following the active file.
 */
export function chooseBranchProject(root: string, defaultRepo: string | null): void {
  useBranchProject.setState({ root, against: defaultRepo });
}

export function setBranchProjectsCollapsed(collapsed: boolean): void {
  useBranchProject.setState({ collapsed });
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  } catch {
    // The state then lasts for this window only.
  }
}

/** The chosen repository while it still applies: one of `roots`, chosen against `defaultRepo`. */
export function chosenBranchProject(
  choice: Pick<BranchProject, "root" | "against">,
  defaultRepo: string | null,
  roots: readonly string[],
): string | null {
  return choice.root && choice.against === defaultRepo && roots.includes(choice.root) ? choice.root : null;
}

/** `chosenBranchProject` of the open project, kept current. */
export function useChosenBranchProject(defaultRepo: string | null): string | null {
  const root = useBranchProject((s) => s.root);
  const against = useBranchProject((s) => s.against);
  return useVcs((s) => chosenBranchProject({ root, against }, defaultRepo, s.roots));
}
