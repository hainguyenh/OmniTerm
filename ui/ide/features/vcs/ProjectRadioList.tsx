/**
 * A collapsible list of a workspace's projects (repositories), one radio each with its branch
 * below the name: the Commit tab chooses the project to commit with it, the Branches popup the
 * project its branch widget shows.
 */
import { Fragment, useId, type ReactNode } from "react";
import type { Worktree } from "@/bindings";
import { tx } from "@/platform/i18n";
import { Icon, Radio } from "@/ui";
import { repoLabel } from "./model";
import { useVcs } from "./store";
import styles from "./CommitView.module.css";

export interface ProjectRadioListProps {
  /** The projects (repository roots) to choose among, in order. */
  repos: readonly string[];
  /** The chosen one. */
  target: string;
  onChoose: (repo: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Radio group name, unique per list. */
  name: string;
  /** Accessible name of the radio group. */
  label: string;
  /** Detail drawn next to a project's name (the Commit tab's change count). */
  detail?: (repo: string) => ReactNode;
  /** Test id of each project's branch line. */
  branchTestId?: string;
  /** Linked worktrees listed under each project (by repository root), with their branch. */
  worktrees?: Readonly<Record<string, readonly Worktree[]>>;
  /** Opens a listed worktree (its folder as a project). */
  onOpenWorktree?: (path: string) => void;
}

/** The last segment of a worktree's folder. */
const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

export function ProjectRadioList({
  repos,
  target,
  onChoose,
  collapsed,
  onCollapsedChange,
  name,
  label,
  detail,
  branchTestId,
  worktrees,
  onOpenWorktree,
}: ProjectRadioListProps) {
  const heads = useVcs((s) => s.heads);
  const projectRoot = useVcs((s) => s.root);
  const listId = useId();
  return (
    <div className={styles.projectPicker}>
      <button
        type="button"
        className={styles.projectHeader}
        aria-expanded={!collapsed}
        aria-controls={listId}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} />
        <span className={styles.projectHeaderTitle}>{tx("Projects")}</span>
        <span className={styles.count}>{repos.length}</span>
        {collapsed && <span className={styles.projectHeaderTarget}>{repoLabel(target, projectRoot)}</span>}
      </button>
      {!collapsed && (
        <div id={listId} className={styles.projectList} role="radiogroup" aria-label={label}>
          {repos.map((repo) => {
            const head = heads[repo];
            const branch = head?.head;
            return (
              <Fragment key={repo}>
                <Radio
                  name={name}
                  checked={repo === target}
                  onChange={() => onChoose(repo)}
                  className={styles.projectChoice}
                  label={
                    <span className={styles.projectChoiceLabel} title={repo}>
                      <span className={styles.projectTitle}>
                        <span className={styles.projectName}>{repoLabel(repo, projectRoot)}</span>
                        {detail?.(repo)}
                      </span>
                      {(branch || head?.linkedWorktree) && (
                        <span className={styles.projectBranch} data-testid={branchTestId}>
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
                {worktrees?.[repo]?.map((w) => (
                  <button
                    key={w.path}
                    type="button"
                    className={styles.projectWorktreeRow}
                    title={tx`Open the worktree at ${w.path} in a new window`}
                    onClick={() => onOpenWorktree?.(w.path)}
                    data-testid="project-worktree"
                  >
                    <Icon name="worktree" size={12} label={tx("Linked worktree")} />
                    <span className={styles.projectName}>{folderName(w.path)}</span>
                    {w.branch && (
                      <span className={styles.projectBranch}>
                        <Icon name="branch" size={12} />
                        <span className={styles.projectBranchName}>{w.branch}</span>
                      </span>
                    )}
                  </button>
                ))}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
