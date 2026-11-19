/**
 * The Commit tab's project choice in a workspace of several repositories: one radio per
 * project with changes. A commit covers exactly one project; the tree shows only its changes.
 */
import { useId, useMemo } from "react";
import { tx } from "@/platform/i18n";
import { Icon, Radio } from "@/ui";
import { changedRepos, commitTarget, groupOf } from "./changes";
import { setProjectsCollapsed, useCommit } from "./commitStore";
import { repoLabel, rootOf } from "./model";
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
  const heads = useVcs((s) => s.heads);
  const projectRoot = useVcs((s) => s.root);
  const collapsed = useCommit((s) => s.projectsCollapsed);
  const target = useCommitTarget();
  const choices = useMemo(() => projectChoices(status, roots), [status, roots]);
  const listId = useId();
  if (!target || !choices.length) return null;
  return (
    <div className={styles.projectPicker}>
      <button
        type="button"
        className={styles.projectHeader}
        aria-expanded={!collapsed}
        aria-controls={listId}
        onClick={() => setProjectsCollapsed(!collapsed)}
      >
        <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} />
        <span className={styles.projectHeaderTitle}>{tx("Projects")}</span>
        <span className={styles.count}>{choices.length}</span>
        {collapsed && <span className={styles.projectHeaderTarget}>{repoLabel(target, projectRoot)}</span>}
      </button>
      {!collapsed && (
        <div id={listId} className={styles.projectList} role="radiogroup" aria-label={tx("Project to commit")}>
          {choices.map(({ repo, count }) => {
            const head = heads[repo];
            const branch = head?.head;
            return (
              <Radio
                key={repo}
                name="commit-project"
                checked={repo === target}
                onChange={() => useCommit.setState({ commitRepo: repo })}
                className={styles.projectChoice}
                label={
                  <span className={styles.projectChoiceLabel} title={repo}>
                    <span className={styles.projectTitle}>
                      <span className={styles.projectName}>{repoLabel(repo, projectRoot)}</span>
                      <span className={styles.count}>{count}</span>
                    </span>
                    {(branch || head?.linkedWorktree) && (
                      <span className={styles.projectBranch} data-testid="commit-project-branch">
                        {head?.linkedWorktree && (
                          <span className={styles.projectWorktree} title={tx("Linked worktree")}>
                            <Icon name="worktree" size={12} label={tx("Linked worktree")} />
                          </span>
                        )}
                        {branch && (
                          <>
                            <Icon name="branch" size={12} />
                            <span className={styles.projectBranchName}>{branch}</span>
                          </>
                        )}
                      </span>
                    )}
                  </span>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
