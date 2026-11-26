/**
 * The root projects of a workspace window (pure): each workspace folder is a project of its own,
 * holding the repositories found in or around it (its repository, nested clones, submodules).
 * Branch operations on all repositories, and the "Branches have diverged" notice, concern the
 * repositories of one root project: independent projects side by side in a workspace are expected
 * to be on different branches.
 */
import type { Worktree } from "@/bindings";
import { groupWorktrees, pathKey, type RepoWorktrees } from "./worktrees";

export interface RootProject {
  /** The workspace folder; `null` for repositories outside every folder. */
  folder: string | null;
  /** Repository roots of the project, in root order. */
  repos: string[];
}

/** Whether `child` is `parent` or lies below it. */
function within(child: string, parent: string): boolean {
  const c = pathKey(child);
  const p = pathKey(parent);
  return c === p || c.startsWith(p.endsWith("/") ? p : `${p}/`);
}

/**
 * The repositories of `roots` grouped by the workspace folder they belong to: the first of
 * `folders` that holds the repository, or that the repository holds (a folder opened below its
 * repository's root). Without folders (a window on one project), every repository is one project.
 */
export function groupRootProjects(roots: readonly string[], folders: readonly string[]): RootProject[] {
  if (!folders.length) return roots.length ? [{ folder: null, repos: [...roots] }] : [];
  const projects: RootProject[] = folders.map((folder) => ({ folder, repos: [] }));
  const outside: RootProject[] = [];
  for (const root of roots) {
    const project = projects.find((p) => p.folder && (within(root, p.folder) || within(p.folder, root)));
    if (project) project.repos.push(root);
    else outside.push({ folder: null, repos: [root] });
  }
  return [...projects.filter((p) => p.repos.length), ...outside];
}

/**
 * The repositories branch operations on all repositories act on: those of the root project
 * holding `current` (all of `roots` when `current` is in none of them).
 */
export function syncScope(roots: readonly string[], folders: readonly string[], current: string | null): string[] {
  const project = current ? groupRootProjects(roots, folders).find((p) => p.repos.includes(current)) : undefined;
  return project ? project.repos : [...roots];
}

/**
 * The linked worktrees to show under each repository root: the repository's worktrees other than
 * its main one and those already listed as roots of their own, keyed by the root naming the
 * repository's group.
 */
export function worktreesByRoot(lists: readonly RepoWorktrees[], roots: readonly string[]): Record<string, Worktree[]> {
  const isRoot = (path: string) => roots.some((root) => pathKey(root) === pathKey(path));
  const out: Record<string, Worktree[]> = {};
  for (const group of groupWorktrees(lists)) {
    const linked = group.worktrees.filter((w) => !w.main && !isRoot(w.path));
    if (linked.length) out[group.root] = linked;
  }
  return out;
}
