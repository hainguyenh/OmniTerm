/**
 * The Commit tab's project choice in a workspace of several repositories: one radio per
 * project with changes. A commit covers exactly one project; the tree shows only its changes.
 */
import { useMemo } from "react";
import { tx } from "@/platform/i18n";
import { Icon, Radio } from "@/ui";
import { changedRepos, commitTarget, groupOf } from "./changes";
import { useCommit } from "./commitStore";
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

export function CommitProjectPicker() {
  const status = useVcs((s) => s.status);
  const roots = useVcs((s) => s.roots);
  const heads = useVcs((s) => s.heads);
  const projectRoot = useVcs((s) => s.root);
  const target = useCommitTarget();
  const choices = useMemo(() => projectChoices(status, roots), [status, roots]);
  if (!target || !choices.length) return null;
  return (
    <div className={styles.projectPicker} role="radiogroup" aria-label={tx("Project to commit")}>
      {choices.map(({ repo, count }) => {
        const branch = heads[repo]?.head;
        return (
          <Radio
            key={repo}
            name="commit-project"
            checked={repo === target}
            onChange={() => useCommit.setState({ commitRepo: repo })}
            className={styles.projectChoice}
            label={
              <span className={styles.projectChoiceLabel} title={repo}>
                <span className={styles.projectName}>{repoLabel(repo, projectRoot)}</span>
                <span className={styles.count}>{count}</span>
                {branch && (
                  <span className={styles.projectBranch}>
                    <Icon name="branch" size={12} />
                    {branch}
                  </span>
                )}
              </span>
            }
          />
        );
      })}
    </div>
  );
}
