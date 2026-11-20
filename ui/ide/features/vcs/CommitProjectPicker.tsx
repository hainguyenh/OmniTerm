/**
 * The Commit tab's project choice in a workspace of several repositories: one radio per
 * project with changes. A commit covers exactly one project; the tree shows only its changes.
 */
import { useMemo } from "react";
import { tx } from "@/platform/i18n";
import { changedRepos, commitTarget, groupOf } from "./changes";
import { setProjectsCollapsed, useCommit } from "./commitStore";
import { rootOf } from "./model";
import { ProjectRadioList } from "./ProjectRadioList";
import { useVcs } from "./store";
import styles from "./CommitView.module.css";

/** The project the Commit tab works on (`null` with a single repository). */
export function useCommitTarget(): string | null {
  const status = useVcs((s) => s.status);
  const roots = useVcs((s) => s.roots);
  const chosen = useCommit((s) => s.commitRepo);
  return useMemo(() => commitTarget(status, roots, chosen), [status, roots, chosen]);
}

/** Changed projects with their change counts, in workspace order. */
export function projectChoices(
  status: Parameters<typeof changedRepos>[0],
  roots: readonly string[],
): { repo: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of status) {
    if (!groupOf(f)) continue;
    const repo = rootOf(f.path, roots);
    if (repo) counts.set(repo, (counts.get(repo) ?? 0) + 1);
  }
  return changedRepos(status, roots).map((repo) => ({ repo, count: counts.get(repo) ?? 0 }));
}

/**
 * The project choice under a collapsible header (the Changes tree keeps its room with many
 * projects; the collapsed state is remembered). Each project shows its branch below its
 * name, with a worktree marker when it is a linked worktree rather than the main one.
 */
export function CommitProjectPicker() {
  const status = useVcs((s) => s.status);
  const roots = useVcs((s) => s.roots);
  const collapsed = useCommit((s) => s.projectsCollapsed);
  const target = useCommitTarget();
  const choices = useMemo(() => projectChoices(status, roots), [status, roots]);
  const counts = useMemo(() => new Map(choices.map(({ repo, count }) => [repo, count])), [choices]);
  if (!target || !choices.length) return null;
  return (
    <ProjectRadioList
      repos={choices.map(({ repo }) => repo)}
      target={target}
      onChoose={(repo) => useCommit.setState({ commitRepo: repo })}
      collapsed={collapsed}
      onCollapsedChange={setProjectsCollapsed}
      name="commit-project"
      label={tx("Project to commit")}
      detail={(repo) => <span className={styles.count}>{counts.get(repo) ?? 0}</span>}
      branchTestId="commit-project-branch"
    />
  );
}
