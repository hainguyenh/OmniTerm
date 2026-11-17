/**
 * Settings page tree (UI specification, `settingsTreeHtml`): top-level groups as bold rows
 * with a chevron, a group icon and a muted page count; pages indented under them, the selected page
 * marked with an accent bar. Groups start expanded; deeper pages open along the selected page's path.
 */
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import clsx from "clsx";
import { Icon, T, type IconName } from "@/ui";
import { tx } from "@/platform/i18n";
import { SearchLabel } from "../components/Form";
import type { PageNode } from "../model/pages";
import styles from "./SettingsTree.module.css";

const GROUP_ICONS: Record<string, IconName> = {
  "Appearance & Behavior": "settings",
  Keymap: "keyboard",
  Editor: "file",
  Security: "lock",
  Plugins: "plugin",
  "Version Control": "branch",
  "Project Structure": "structure",
  "Build, Execution, Deployment": "build-project",
  "Languages & Frameworks": "file-code",
  Agents: "toolwindow-agents",
  Tools: "terminal",
  // OmniTerm: the short names its layout gives the groups (`ui/workbench/settings/settingsLayout.ts`).
  General: "settings",
  Terminal: "terminal",
  VCS: "branch",
  Code: "file-code",
  Run: "run",
  Updates: "download",
};

export interface SettingsTreeHandle {
  /** Moves the selection to the next (`1`) or previous (`-1`) visible page. */
  moveSelection(delta: number): void;
}

interface Row {
  node: PageNode;
  depth: number;
  open: boolean;
}

/** Pages below `node` (folders without a page of their own are not counted). */
function pageCount(node: PageNode): number {
  return node.children.reduce((n, c) => n + (c.page ? 1 : 0) + pageCount(c), 0);
}

function visibleRows(nodes: readonly PageNode[], isOpen: (n: PageNode, depth: number) => boolean, depth = 0): Row[] {
  return nodes.flatMap((node) => {
    const open = node.children.length > 0 && isOpen(node, depth);
    const row: Row = { node, depth, open };
    return open ? [row, ...visibleRows(node.children, isOpen, depth + 1)] : [row];
  });
}

export function SettingsTree({
  roots,
  counts,
  selected,
  ancestors,
  searching,
  dirty,
  onSelect,
  handleRef,
}: {
  /** The (filtered) nodes to show. */
  roots: readonly PageNode[];
  /** Unfiltered roots, for the page counts. */
  counts: readonly PageNode[];
  selected: string | undefined;
  /** Keys above the selected page; they open so the selection is visible. */
  ancestors: readonly string[];
  /** A search is active: every match is shown, expanded. */
  searching: boolean;
  dirty: ReadonlySet<string>;
  onSelect: (key: string) => void;
  handleRef?: Ref<SettingsTreeHandle>;
}) {
  // Explicit toggles win over the defaults (groups open, deeper levels open on the selected path).
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const countOf = useMemo(() => new Map(counts.map((n) => [n.key, pageCount(n)])), [counts]);
  const onPath = useMemo(() => new Set(ancestors), [ancestors]);
  const rows = useMemo(
    () =>
      visibleRows(roots, (n, depth) => {
        if (searching) return true;
        return toggled.get(n.key) ?? (depth === 0 || onPath.has(n.key));
      }),
    [roots, searching, toggled, onPath],
  );
  const pages = rows.filter((r) => r.node.page);

  const toggle = (row: Row) => setToggled((m) => new Map(m).set(row.node.key, !row.open));
  const expand = (row: Row) => {
    if (!row.open && row.node.children.length) toggle(row);
  };
  const move = (delta: number) => {
    if (!pages.length) return;
    const at = pages.findIndex((r) => r.node.key === selected);
    const next = at < 0 ? (delta > 0 ? 0 : pages.length - 1) : Math.min(pages.length - 1, Math.max(0, at + delta));
    onSelect(pages[next]!.node.key);
  };
  useImperativeHandle(handleRef, () => ({ moveSelection: move }));
  const treeRef = useRef<HTMLDivElement>(null);
  // Opened on a page (e.g. Agent quota's "Settings" link) or moved with the keys: keep it in view.
  useEffect(() => {
    if (!selected) return;
    const row = [...(treeRef.current?.querySelectorAll<HTMLElement>("[data-key]") ?? [])].find(
      (el) => el.dataset.key === selected,
    );
    row?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  const activate = (row: Row) => {
    // A folder only opens and closes; a page is shown (and opens to show its sub-pages).
    if (!row.node.page?.component && row.node.children.length) {
      if (row.node.page && !row.open) onSelect(row.node.key);
      toggle(row);
      return;
    }
    onSelect(row.node.key);
    expand(row);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = rows.find((r) => r.node.key === selected);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (row && (e.key === "ArrowRight" || e.key === "ArrowLeft") && row.node.children.length) {
      e.preventDefault();
      if ((e.key === "ArrowRight") !== row.open) toggle(row);
    }
  };

  if (!rows.length) {
    return (
      <div className={styles.empty}>
        <T>No settings match.</T>
      </div>
    );
  }

  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label={tx("Settings pages")}
      className={styles.tree}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => {
        const { node, depth, open } = row;
        const isSelected = node.key === selected;
        const parent = node.children.length > 0;
        const top = depth === 0;
        const icon = GROUP_ICONS[node.title] ?? "settings";
        return (
          <div
            key={node.key}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={isSelected}
            aria-expanded={parent ? open : undefined}
            data-key={node.key}
            className={clsx(
              top ? styles.group : styles.page,
              isSelected && styles.selected,
              dirty.has(node.key) && styles.dirty,
            )}
            style={top ? undefined : { marginLeft: 28 + (depth - 1) * 14 }}
            onClick={() => activate(row)}
          >
            {parent && (
              <span
                className={clsx(styles.chevron, !top && styles.nestedChevron)}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(row);
                }}
              >
                <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
              </span>
            )}
            {top && <Icon name={icon} size={16} className={styles.groupIcon} />}
            <SearchLabel text={node.title} className={styles.label} />
            {top && parent && <span className={styles.count}>{countOf.get(node.key) ?? pageCount(node)}</span>}
          </div>
        );
      })}
    </div>
  );
}
