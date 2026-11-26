import { branchesByRepo } from "./multiRoot";
/** Title bar branch widget (branch name + incoming / outgoing markers) + Branches popup. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import clsx from "clsx";
import { create } from "zustand";
import type { Branch, BranchInfo, Worktree } from "@/bindings";
import { executeAction } from "@/platform/actions";
import { call, commands } from "@/platform/ipc";
import { bindingsFor, normalizeBinding, registerKeyClaim, shortcutLabel, strokeOf } from "@/platform/keymap";
import { useEditorRegistry } from "@/editor/api";
import {
  BarButton,
  HighlightedText,
  Icon,
  IconButton,
  List,
  listNavigate,
  Menu,
  MenuList,
  Popup,
  SearchField,
  firstSelectable,
  type MenuItem,
  T,
} from "@/ui";
import type { PopupAnchor } from "@/ui/Popup";
import { buildBranchRows, withExpanded, type BranchRow, type PopupAction } from "./branches";
import { branchPresentation, extensionPopupActions, useBranchWidgetExtensions } from "./branchWidgetExtensions";
import { branchMenu, commonBranchMenu, inRepo, tagMenu } from "./branchMenu";
import { loadFavoriteBranches, recentBranches, toggleFavoriteBranch, useFavoriteBranches } from "./branchOps";
import { inProgress, operationTitle, type InProgress } from "./operations";
import {
  buildMultiRepoRows,
  currentRepoFor,
  widgetShowsRepo,
  type RepoEntry,
  type RepoRow,
} from "./repoBranches";
import { currentRepo, focusRepo, loadBranches, repoName, selectRepo, useVcs } from "./store";
import { useWorkspaceStore } from "../../../platform/workspaceStore";
import { decodeWorkspaceSelection } from "../../../utils/workspaceSelection";
import { rootContaining } from "../../../workbench/footerGitModel";
import { BranchSync } from "./BranchSync";
import { showSyncCommits } from "./SyncCommitsPopup";
import type { SyncDirection } from "./syncCommits";
import { chooseBranchProject, setBranchProjectsCollapsed, useBranchProject, useChosenBranchProject } from "./branchProject";
import { ProjectRadioList } from "./ProjectRadioList";
import { groupRootProjects, syncScope, worktreesByRoot } from "./rootProjects";
import type { RepoWorktrees } from "./worktrees";
import styles from "./BranchWidget.module.css";
import { tx } from "@/platform/i18n";
import { useWorkflowSettings } from "@/platform/workflowSettings";

/** `fromStatus`: opened from the status bar's branch widget, so it opens above that widget. */
export const useBranchesPopup = create<{ open: boolean; fromStatus?: boolean }>(() => ({ open: false }));
export const showBranchesPopup = () => useBranchesPopup.setState({ open: true, fromStatus: false });
export const showBranchesPopupFromStatus = () => useBranchesPopup.setState({ open: true, fromStatus: true });

export function headLabel(branch: { head: string | null; headCommit: string | null } | null): string {
  if (!branch) return "";
  if (branch.head) return branch.head;
  return branch.headCommit ? branch.headCommit.slice(0, 8) : tx("No commits");
}

/**
 * The current repository: the project chosen in the Branches popup's project list, else
 * `currentRepoFor` (the active file's, else the default project's). The widget and the popup show
 * the same one.
 */
function useCurrentRepo(): { current: string | null; chosen: boolean } {
  const path = useEditorRegistry((s) => s.active?.ctx.path ?? null);
  const { defaultRepo, chosen } = useShownProjectRepo();
  const following = useVcs((s) => currentRepoFor(path, s.roots, defaultRepo ?? s.repo));
  return { current: chosen ?? following, chosen: chosen !== null };
}

/** The repository of the default (selected) project. */
function useDefaultProjectRepo(): string | null {
  const folder = useWorkspaceStore((s) => {
    const selection = decodeWorkspaceSelection(s.selection);
    const folders = s.workspaces.find((w) => w.id === selection?.workspaceId)?.folders?.filter((f) => !f.disabled) ?? [];
    return (folders.find((f) => f.id === selection?.folderId) ?? folders[0])?.path ?? null;
  });
  return useVcs((s) => (folder ? rootContaining(folder, s.roots) : null));
}

/** The active folders of the selected workspace: its root projects (none outside a workspace). */
function useWorkspaceFolders(): string[] {
  const joined = useWorkspaceStore((s) => {
    const selection = decodeWorkspaceSelection(s.selection);
    const folders = s.workspaces.find((w) => w.id === selection?.workspaceId)?.folders ?? [];
    return folders
      .filter((f) => !f.disabled)
      .map((f) => f.path)
      .join("\n");
  });
  return useMemo(() => (joined ? joined.split("\n") : []), [joined]);
}

/**
 * The repositories branch operations on all repositories act on (the current root project's),
 * and how many root projects the window holds.
 */
function useRootProjects(current: string | null): { scope: string[]; projects: number } {
  const folders = useWorkspaceFolders();
  const roots = useVcs((s) => s.roots);
  return useMemo(
    () => ({ scope: syncScope(roots, folders, current), projects: groupRootProjects(roots, folders).length }),
    [roots, folders, current],
  );
}

/**
 * The default project's repository and the project chosen in the popup (`null`: none). The shown
 * one (the chosen, else the default) is selected, so the title and the branch operations follow
 * it instead of staying on the first repository.
 */
function useShownProjectRepo(): { defaultRepo: string | null; chosen: string | null } {
  const defaultRepo = useDefaultProjectRepo();
  const chosen = useChosenBranchProject(defaultRepo);
  const shown = chosen ?? defaultRepo;
  useEffect(() => {
    if (shown) void selectRepo(shown);
  }, [shown]);
  return { defaultRepo, chosen };
}

export function BranchWidget() {
  const available = useVcs((s) => s.available);
  const selected = useVcs((s) => s.branch);
  const count = useVcs((s) => s.roots.length);
  const { current, chosen } = useCurrentRepo();
  const { scope, projects } = useRootProjects(current);
  // Several repositories of one root project on different branches, or several root projects
  // (independent, so their branches differ as a rule): the widget names the current one.
  const diverged = useVcs((s) => widgetShowsRepo(scope.map((r) => ({ head: s.heads[r]?.head ?? null }))));
  const named = diverged || projects > 1;
  // The current repository is not the selected one: its HEAD from the last scan (no upstream).
  const other = useVcs((s) => (named && current && current !== s.repo ? (s.heads[current] ?? null) : null));
  const otherOp = useVcs((s) => (current ? (s.operations[current] ?? null) : null));
  const open = useBranchesPopup((s) => s.open);
  const extensions = useBranchWidgetExtensions((s) => s.extensions);
  if (!available || !selected) return null;
  // Another feature presents the current branch (the GitHub pull request on it).
  const presented = other ? null : branchPresentation(extensions);
  // A project chosen in the popup is named too, so the widget says which one it shows.
  const repo = (named || (chosen && count > 1)) && current ? repoName(current) : null;
  const branch: BranchInfo = other
    ? { head: other.head, headCommit: other.headCommit, upstream: null, ahead: 0, behind: 0, operation: otherOp }
    : selected;
  const head = branch.operation ? `${headLabel(branch)} (${branch.operation})` : headLabel(branch);
  const sync =
    branch.behind > 0 && branch.ahead > 0
      ? tx`${branch.behind} incoming, ${branch.ahead} outgoing commits`
      : branch.behind > 0
        ? tx`${branch.behind} incoming commits`
        : branch.ahead > 0
          ? tx`${branch.ahead} outgoing commits`
          : "";
  const tooltip = [
    presented?.tooltip ?? "",
    repo ? tx`Repository: ${repo}` : "",
    tx`Git branch: ${head}`,
    branch.upstream ? tx`Tracking ${branch.upstream}` : "",
    scope.length > 1 && !repo ? tx`In all ${scope.length} repositories` : "",
    sync,
  ]
    .filter(Boolean)
    .join("\n");
  // A count lists its commits; the rest of the widget keeps opening the branches popup.
  const openSync = (direction: SyncDirection) => (e: MouseEvent) => {
    e.stopPropagation();
    useBranchesPopup.setState({ open: false });
    showSyncCommits({
      repo: current,
      branch: { branch: branch.head, upstream: branch.upstream, ahead: branch.ahead, behind: branch.behind },
      direction,
    });
  };
  return (
    <>
      <BarButton
        data-branches-widget
        variant="title"
        className={styles.widget}
        tooltip={tooltip}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => useBranchesPopup.setState({ open: !open, fromStatus: false })}
      >
        <Icon name={presented?.icon ?? (branch.head ? "branch" : "commit")} size={16} className={styles.icon} />
        {repo && <span className={styles.repo}>{repo}</span>}
        <span className={styles.name}>
          {inProgress(branch.operation)
            ? operationTitle(inProgress(branch.operation)!, branch.head)
            : (presented?.text ?? headLabel(branch))}
        </span>
        {branch.operation && !inProgress(branch.operation) && (
          <span className={styles.operation}>{branch.operation}</span>
        )}
        {/* Muted ↓incoming ↑outgoing counts; the tooltip spells them out, a click lists the commits. */}
        {(branch.behind > 0 || branch.ahead > 0) && (
          <span className={styles.sync} aria-hidden="true">
            {branch.behind > 0 && (
              <span className={styles.syncCount} data-sync-direction="incoming" onClick={openSync("incoming")}>
                ↓{branch.behind}
              </span>
            )}
            {branch.behind > 0 && branch.ahead > 0 && " "}
            {branch.ahead > 0 && (
              <span className={styles.syncCount} data-sync-direction="outgoing" onClick={openSync("outgoing")}>
                ↑{branch.ahead}
              </span>
            )}
          </span>
        )}
        <Icon name="chevron-down" size={12} className={styles.chevron} />
      </BarButton>
    </>
  );
}

export function BranchesPopupHost() {
  const open = useBranchesPopup((s) => s.open);
  const fromStatus = useBranchesPopup((s) => !!s.fromStatus);
  if (!open) return null;
  const statusAnchor = fromStatus ? document.querySelector("[data-status-branches-widget]") : null;
  const anchor = statusAnchor ??
    document.querySelector("[data-branches-widget]") ?? { x: window.innerWidth / 2 - 160, y: 60 };
  return (
    <BranchesPopup
      anchor={anchor}
      placement={statusAnchor ? "top-end" : "bottom-start"}
      onClose={() => useBranchesPopup.setState({ open: false })}
    />
  );
}

const POPUP_ACTIONS: PopupAction[] = [
  { id: "vcs.update", label: "Update Project…", icon: "git-pull", group: "sync" },
  { id: "vcs.commit", label: "Commit…", icon: "commit", group: "sync" },
  { id: "vcs.push", label: "Push…", icon: "git-push", group: "sync" },
  { id: "vcs.syncCommits", label: "Incoming and Outgoing Commits…", icon: "history", group: "sync" },
  { id: "vcs.newBranch", label: "New Branch…", icon: "plus", group: "branch" },
  { id: "vcs.checkoutRevision", label: "Checkout Tag or Revision…", icon: "branch", group: "branch" },
];

const OPTIONS_KEY = "omniterm.vcs.branchesPopup.options";

interface PopupOptions {
  groupByPrefix: boolean;
  showRecent: boolean;
  showTags: boolean;
}

function loadOptions(): PopupOptions {
  const out: PopupOptions = { groupByPrefix: true, showRecent: true, showTags: true };
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null");
    if (v && typeof v === "object")
      for (const k of Object.keys(out) as (keyof PopupOptions)[]) {
        const x = (v as Record<string, unknown>)[k];
        if (typeof x === "boolean") out[k] = x;
      }
  } catch {
    // Storage unavailable: defaults.
  }
  return out;
}

/** The popup's gear options (Group by Prefix, Show Recent Branches, Show Tags), kept across sessions. */
const usePopupOptions = create<PopupOptions>(loadOptions);

function toggleOption(key: keyof PopupOptions) {
  usePopupOptions.setState((s) => ({ [key]: !s[key] }));
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(usePopupOptions.getState()));
  } catch {
    // Kept for this session only.
  }
}

/** Groups and folders the user expanded or collapsed, remembered for the session (per popup kind). */
const useExpansion = create<{ single: ReadonlyMap<string, boolean>; multi: ReadonlyMap<string, boolean> }>(() => ({
  single: new Map(),
  multi: new Map(),
}));

function useExpanded(kind: "single" | "multi") {
  const expanded = useExpansion((s) => s[kind]);
  const setOpen = (key: string, open: boolean) =>
    useExpansion.setState((s) => (s[kind].get(key) === open ? s : { [kind]: withExpanded(s[kind], key, open) }));
  return [expanded, setOpen] as const;
}

/** Whether a keystroke is New Branch's shortcut (⌥⌘N, shared with Inline: the popup claims it). */
function isNewBranchStroke(stroke: string | null): boolean {
  if (!stroke) return false;
  const s = normalizeBinding(stroke);
  return bindingsFor("vcs.newBranch").some((b) => normalizeBinding(b) === s);
}

function OptionsButton({ hasTags }: { hasTags: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const options = usePopupOptions();
  const items: MenuItem[] = [
    { label: "Group by Prefix", checked: options.groupByPrefix, run: () => toggleOption("groupByPrefix") },
    { label: "Show Recent Branches", checked: options.showRecent, run: () => toggleOption("showRecent") },
    ...(hasTags ? [{ label: "Show Tags", checked: options.showTags, run: () => toggleOption("showTags") }] : []),
  ];
  return (
    <>
      <IconButton
        icon="settings"
        title="Options"
        size="small"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      />
      {anchor && (
        <Menu
          open
          anchor={anchor}
          placement="bottom-end"
          items={items}
          onClose={() => setAnchor(null)}
          aria-label="Branches Popup Options"
        />
      )}
    </>
  );
}

/** Entries IDEA puts at the top of the Branches popup while an operation is stopped. */
export function operationActions(op: InProgress | null, conflicts: number): PopupAction[] {
  const out: PopupAction[] = [];
  // Conflicts are resolved whether or not an operation is stopped: applying a stash, or the
  // autostash of a pull, leaves them with none in progress.
  if (conflicts) out.push({ id: "vcs.resolveConflicts", label: "Resolve Conflicts…", icon: "warning" });
  if (!op) return out;
  const ids: Record<InProgress, Array<[string, string]>> = {
    rebase: [
      ["vcs.rebase.continue", "Continue Rebase"],
      ["vcs.rebase.skip", "Skip Commit"],
      ["vcs.rebase.abort", "Abort Rebase"],
    ],
    merge: [["vcs.merge.abort", "Abort Merge"]],
    "cherry-pick": [
      ["vcs.cherryPick.continue", "Continue Cherry-Pick"],
      ["vcs.cherryPick.abort", "Abort Cherry-Pick"],
    ],
    revert: [
      ["vcs.revert.continue", "Continue Revert"],
      ["vcs.revert.abort", "Abort Revert"],
    ],
    am: [],
  };
  for (const [id, label] of ids[op]) out.push({ id, label });
  return out;
}

const INDENT = 16;
const ROW_HEIGHT = 24;
const SEPARATOR_HEIGHT = 9;
const listHeight = (rows: readonly { type: string; key: string }[]) =>
  Math.min(
    440,
    Math.max(
      ROW_HEIGHT * 3,
      rows.reduce(
        (h, r) => h + (r.type === "section" && r.key.startsWith("separator:") ? SEPARATOR_HEIGHT : ROW_HEIGHT),
        0,
      ),
    ),
  );

/** The option element of the row with `key`, to anchor a submenu on. */
function rowElement(list: HTMLElement | null, key: string): HTMLElement | null {
  const el = list?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`);
  return el ? ((el.closest('[role="option"]') as HTMLElement | null) ?? el) : null;
}

/** Caret at the end (→ opens) / start (← closes) of the search field. */
const caretAt = (e: KeyboardEvent, where: "start" | "end") => {
  const input = e.target as HTMLInputElement;
  if (input.selectionStart !== input.selectionEnd) return false;
  return where === "end" ? input.selectionStart === input.value.length : input.selectionStart === 0;
};

function BranchesPopup({
  anchor,
  placement,
  onClose,
}: {
  anchor: PopupAnchor;
  placement: "top-end" | "bottom-start";
  onClose: () => void;
}) {
  const multi = useVcs((s) => s.roots.length > 1);
  const extensions = useBranchWidgetExtensions((s) => s.extensions);
  const actions = useMemo(() => [...POPUP_ACTIONS, ...extensionPopupActions(extensions)], [extensions]);
  // ⌥⌘N is also Inline (enabled while a popup is open over an editor): the search field handles it here.
  useEffect(() => registerKeyClaim((_e, stroke) => isNewBranchStroke(stroke)), []);
  return (
    <Popup
      open
      anchor={anchor}
      onClose={onClose}
      placement={placement}
      aria-label="Git Branches"
      className={clsx(styles.popup, multi && styles.wide)}
    >
      {multi ? (
        <MultiRepoPanel onClose={onClose} actions={actions} />
      ) : (
        <BranchesPanel onClose={onClose} actions={actions} />
      )}
    </Popup>
  );
}

/** Search, actions and the branches of the selected repository. */
function BranchesPanel({ onClose, actions: baseActions }: { onClose: () => void; actions: readonly PopupAction[] }) {
  const selected = useVcs((s) => s.repo);
  const branches = useVcs((s) => s.branches);
  const loaded = useVcs((s) => s.branchesLoaded);
  const current = useVcs((s) => s.branch?.head ?? null);
  const [query, setQuery] = useState("");
  const [recent] = useState(recentBranches);
  const [active, setActive] = useState(0);
  const [menuFor, setMenuFor] = useState<{ items: MenuItem[]; label: string; el: HTMLElement } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const favorites = useFavoriteBranches((s) => s.names);
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    void loadBranches().catch(() => undefined);
    loadFavoriteBranches();
  }, []);
  useEffect(() => {
    let live = true;
    call(commands.vcsTags(currentRepo())).then(
      (t) => live && setTags(t),
      () => live && setTags([]),
    );
    return () => {
      live = false;
    };
  }, [selected, branches]);

  const op = useVcs((s) => inProgress(s.branch?.operation));
  const conflicts = useVcs((s) => s.status.filter((f) => f.unstaged === "conflicted").length);
  const actions = useMemo(() => [...operationActions(op, conflicts), ...baseActions], [op, conflicts, baseActions]);
  const options = usePopupOptions();
  const [expanded, setOpen] = useExpanded("single");
  const rows = useMemo(
    () => buildBranchRows(branches, recent, query, actions, favorites, tags, { ...options, expanded }),
    [branches, recent, query, actions, favorites, tags, options, expanded],
  );
  const isSection = (r: BranchRow) => r.type === "section";
  const activeIndex = rows[active] && !isSection(rows[active]!) ? active : firstSelectable(rows, isSection);
  const closeAll = () => {
    setMenuFor(null);
    onClose();
  };
  const openMenu = (i: number) => {
    const row = rows[i];
    if (row?.type !== "branch" && row?.type !== "tag") return;
    const el = rowElement(listRef.current, row.key);
    if (!el) return;
    setMenuFor(
      row.type === "branch"
        ? { items: branchMenu(row.branch, current, closeAll), label: tx`Branch ${row.branch.name}`, el }
        : { items: tagMenu(row.tag, closeAll), label: tx`Tag ${row.tag}`, el },
    );
  };

  const run = (id: string, arg?: unknown) => {
    onClose();
    void executeAction(id, arg);
  };
  const activate = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.type === "action") {
      run(row.action.id, row.action.arg);
    } else if (row.type === "group") {
      if (!query.trim()) setOpen(row.key, !row.expanded);
    } else if (row.type === "branch" || row.type === "tag") {
      openMenu(i);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isNewBranchStroke(strokeOf(e))) {
      e.preventDefault();
      run("vcs.newBranch");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      activate(activeIndex);
      return;
    }
    const row = rows[activeIndex];
    if (e.key === "ArrowRight" && (row?.type === "branch" || row?.type === "tag" || row?.type === "group")) {
      if (caretAt(e, "end")) {
        e.preventDefault();
        if (row.type !== "group") openMenu(activeIndex);
        else if (!query.trim()) setOpen(row.key, true);
      }
      return;
    }
    if (e.key === "ArrowLeft" && row?.type === "group" && row.expanded && !query.trim() && caretAt(e, "start")) {
      e.preventDefault();
      setOpen(row.key, false);
      return;
    }
    const next = listNavigate(e.key, { items: rows, active: activeIndex, isSection, wrap: true });
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  const label = "Search branches and actions";
  return (
    <>
      <div className={styles.search}>
        <SearchField
          data-autofocus
          value={query}
          onChange={(v) => {
            setQuery(v);
            setActive(0);
          }}
          placeholder={label}
          aria-label={label}
          variant="bare"
          onKeyDown={onKeyDown}
        />
        <IconButton icon="git-fetch" title="Fetch" size="small" action="vcs.fetch" />
        <OptionsButton hasTags={tags.length > 0} />
      </div>
      <div ref={listRef} style={{ height: listHeight(rows) }} className={styles.listWrap}>
        <List
          items={rows}
          getKey={(r) => r.key}
          isSection={isSection}
          sectionHeightOf={(r) => (r.type === "section" && !r.label ? SEPARATOR_HEIGHT : undefined)}
          renderSection={(r) =>
            r.type === "section" && r.label ? (
              <span className={styles.section}>{tx(r.label)}</span>
            ) : (
              <span className={styles.separator} role="separator" />
            )
          }
          activeIndex={activeIndex}
          onActiveChange={setActive}
          onActivate={(_r, i) => activate(i)}
          focusable={false}
          hoverSelects
          rowHeight={ROW_HEIGHT}
          aria-label="Branches"
          className={styles.list}
          empty={<span className={styles.empty}>{loaded ? tx("No matching branches") : tx("Loading…")}</span>}
          renderItem={(r) => (r.type === "group" ? <GroupRowView row={r} /> : <BranchRowView row={r} />)}
        />
      </div>
      {menuFor && <SubMenu {...menuFor} onClose={() => setMenuFor(null)} />}
    </>
  );
}

function SubMenu({
  items,
  label,
  el,
  onClose,
}: {
  items: MenuItem[];
  label: string;
  el: HTMLElement;
  onClose: () => void;
}) {
  return (
    <Popup
      open
      anchor={el}
      placement="right-start"
      offset={2}
      role="presentation"
      autoFocus={false}
      onClose={onClose}
      className={styles.menuPopup}
    >
      <MenuList items={items} onDone={onClose} onCloseLevel={onClose} aria-label={label} />
    </Popup>
  );
}

/**
 * Branches popup of a project with several repositories: actions, the project list choosing the
 * repository shown, then the branches they all have (acting on all of them) or, when their
 * branches differ, the current repository's. A search also lists the other repositories' branches.
 */
function MultiRepoPanel({ onClose, actions: popupActions }: { onClose: () => void; actions: readonly PopupAction[] }) {
  const roots = useVcs((s) => s.roots);
  const heads = useVcs((s) => s.heads);
  const version = useVcs((s) => s.version);
  const favorites = useFavoriteBranches((s) => s.names);
  const { current } = useCurrentRepo();
  const defaultRepo = useDefaultProjectRepo();
  const projectsCollapsed = useBranchProject((s) => s.collapsed);
  const showProject = (root: string) => {
    chooseBranchProject(root, defaultRepo);
    void focusRepo(root);
  };
  const [recent] = useState(recentBranches);
  const [tags, setTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [expanded, setOpen] = useExpanded("multi");
  const options = usePopupOptions();
  const { scope } = useRootProjects(current);
  // Branch operations act on all repositories of the current root project, not on independent
  // projects of the workspace.
  const sync = useWorkflowSettings((s) => s.vcs.git.syncBranchOperations) && scope.length > 1;
  const [all, setAll] = useState<Record<string, Branch[]>>({});
  const [menuFor, setMenuFor] = useState<{ items: MenuItem[]; label: string; el: HTMLElement } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => loadFavoriteBranches(), []);
  // Every repository's branches (common ones, submenus, search); refreshed after operations.
  useEffect(() => {
    let live = true;
    void branchesByRepo(roots)
      .then((entries) => live && setAll(entries))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [roots, version]);
  // The linked worktrees listed under their project (refreshed with the branches).
  const [worktrees, setWorktrees] = useState<Record<string, Worktree[]>>({});
  useEffect(() => {
    let live = true;
    void Promise.all(
      roots.map((root) =>
        call(commands.vcsWorktrees(root)).then(
          (list): RepoWorktrees => ({ root, worktrees: list }),
          (): RepoWorktrees => ({ root, worktrees: [] }),
        ),
      ),
    ).then((lists) => live && setWorktrees(worktreesByRoot(lists, roots)));
    return () => {
      live = false;
    };
  }, [roots, version]);
  useEffect(() => {
    let live = true;
    if (current)
      call(commands.vcsTags(current)).then(
        (t) => live && setTags(t),
        () => live && setTags([]),
      );
    return () => {
      live = false;
    };
  }, [current, version]);

  const repos = useMemo<RepoEntry[]>(
    () =>
      roots.map((root) => ({
        root,
        name: repoName(root),
        head: heads[root]?.head ?? null,
        headCommit: heads[root]?.headCommit ?? null,
      })),
    [roots, heads],
  );
  const op = useVcs((s) => inProgress(s.branch?.operation));
  const conflicts = useVcs((s) => s.status.filter((f) => f.unstaged === "conflicted").length);
  const actions = useMemo(
    () => [
      ...operationActions(op, conflicts),
      ...popupActions.map((a) => (a.id === "vcs.newBranch" && sync ? { ...a, arg: { repos: scope } } : a)),
    ],
    [op, conflicts, scope, popupActions, sync],
  );
  const rows = useMemo(
    () =>
      buildMultiRepoRows({
        ...options,
        repos,
        branches: all,
        query,
        actions,
        expanded,
        favorites,
        current,
        recent,
        tags,
        sync,
        scope,
      }),
    [repos, all, query, actions, expanded, favorites, current, recent, tags, options, sync, scope],
  );
  const isSection = (r: RepoRow) => r.type === "section" || r.type === "notice";
  const activeIndex = rows[active] && !isSection(rows[active]!) ? active : firstSelectable(rows, isSection);

  const closeAll = () => {
    setMenuFor(null);
    onClose();
  };
  /** Opens the menu of row `i`. */
  const openSub = (i: number) => {
    const row = rows[i];
    if (!row) return;
    const el = rowElement(listRef.current, row.key);
    if (!el) return;
    if (row.type === "common") {
      const synced = repos.filter((r) => scope.includes(r.root));
      const shared = widgetShowsRepo(synced) ? null : (synced[0]?.head ?? null);
      setMenuFor({
        items: commonBranchMenu(row.branch, scope, shared, closeAll),
        label: tx`Branch ${row.branch.name}`,
        el,
      });
    } else if (row.type === "branch") {
      const items = inRepo(row.repo.root, branchMenu(row.branch, row.repo.head, closeAll));
      setMenuFor({ items, label: tx`Branch ${row.branch.name} of ${row.repo.name}`, el });
    } else if (row.type === "tag") {
      setMenuFor({ items: inRepo(row.repo.root, tagMenu(row.tag, closeAll)), label: tx`Tag ${row.tag}`, el });
    }
  };
  const activate = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.type === "action") {
      onClose();
      void executeAction(row.action.id, row.action.arg);
    } else if (row.type === "group") {
      if (!query.trim()) setOpen(row.key, !row.expanded);
    } else {
      openSub(i);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isNewBranchStroke(strokeOf(e))) {
      e.preventDefault();
      onClose();
      void executeAction("vcs.newBranch", sync ? { repos: scope } : undefined);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      activate(activeIndex);
      return;
    }
    const row = rows[activeIndex];
    if (e.key === "ArrowRight" && row && row.type !== "action" && row.type !== "section") {
      if (!caretAt(e, "end")) return;
      e.preventDefault();
      if (row.type === "group") {
        if (!query.trim()) setOpen(row.key, true);
      } else openSub(activeIndex);
      return;
    }
    if (e.key === "ArrowLeft" && row?.type === "group" && row.expanded) {
      if (!caretAt(e, "start") || query.trim()) return;
      e.preventDefault();
      setOpen(row.key, false);
      return;
    }
    const next = listNavigate(e.key, { items: rows, active: activeIndex, isSection, wrap: true });
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  return (
    <>
      <div className={styles.search}>
        <SearchField
          className={styles.searchGrow}
          data-autofocus
          value={query}
          onChange={(v) => {
            setQuery(v);
            setActive(0);
          }}
          placeholder="Search branches and actions"
          aria-label="Search branches and actions"
          variant="bare"
          onKeyDown={onKeyDown}
        />
        <IconButton icon="git-fetch" title="Fetch" size="small" action="vcs.fetch" />
        <OptionsButton hasTags={tags.length > 0} />
      </div>
      {/* Which project the branch widget shows, chosen like the Commit tab's project. */}
      {current && (
        <div className={styles.projects}>
          <ProjectRadioList
            repos={roots}
            target={current}
            onChoose={showProject}
            collapsed={projectsCollapsed}
            onCollapsedChange={setBranchProjectsCollapsed}
            name="branches-project"
            label={tx("Project the branch widget shows")}
            branchTestId="branches-project-branch"
            worktrees={worktrees}
            onOpenWorktree={(path) => {
              onClose();
              void executeAction("file.openProjectPath", path);
            }}
          />
        </div>
      )}
      <div ref={listRef} style={{ height: listHeight(rows) }} className={styles.listWrap}>
        <List
          items={rows}
          getKey={(r) => r.key}
          isSection={isSection}
          sectionHeightOf={(r) => (r.type === "section" && !r.label ? SEPARATOR_HEIGHT : undefined)}
          renderSection={(r) =>
            r.type === "notice" ? (
              <span className={styles.notice} title={r.detail} role="status">
                <Icon name="warning" size={14} />
                <span className={styles.noticeLabel}>{r.label}</span>
                <span className={styles.noticeDetail}>{r.detail}</span>
              </span>
            ) : r.type === "section" && r.label ? (
              <span className={styles.section}>{tx(r.label)}</span>
            ) : (
              <span className={styles.separator} role="separator" />
            )
          }
          activeIndex={activeIndex}
          onActiveChange={setActive}
          onActivate={(_r, i) => activate(i)}
          focusable={false}
          hoverSelects
          rowHeight={ROW_HEIGHT}
          aria-label="Branches"
          className={styles.list}
          empty={
            <span className={styles.empty}>
              <T>No matching branches</T>
            </span>
          }
          renderItem={(r) => <RepoRowView row={r} />}
        />
      </div>
      {menuFor && <SubMenu {...menuFor} onClose={() => setMenuFor(null)} />}
    </>
  );
}

function RepoRowView({ row }: { row: RepoRow }) {
  switch (row.type) {
    case "action":
    case "branch":
    case "tag":
      return <BranchRowView row={row} />;
    case "group":
      return <GroupRowView row={row} />;
    case "common":
      return (
        <span className={styles.row} data-row-key={row.key} style={{ paddingLeft: row.depth * INDENT }}>
          <Icon
            name={row.branch.current ? "current-branch" : row.branch.favorite ? "star" : "branch"}
            size={14}
            className={clsx(styles.rowIcon, row.branch.current && styles.currentIcon)}
          />
          <HighlightedText
            className={clsx(styles.label, styles.branchName, row.branch.current && styles.current)}
            text={row.label}
            indices={row.matches}
            tone="accent"
          />
          {row.branch.current && (
            <span className={styles.tag}>
              <T>current</T>
            </span>
          )}
          <Icon name="chevron-right" size={10} className={styles.chevron} />
        </span>
      );
    default:
      return null;
  }
}

/** A collapsible group (Recent / Local / Remote / Tags) or a prefix folder. Folder names are not translated. */
function GroupRowView({ row }: { row: { key: string; label: string; expanded: boolean; depth: number } }) {
  return (
    <span
      className={clsx(styles.row, row.depth === 0 && styles.groupRow)}
      data-row-key={row.key}
      style={row.depth ? { paddingLeft: row.depth * INDENT } : undefined}
      aria-expanded={row.expanded}
    >
      <Icon name={row.expanded ? "chevron-down" : "chevron-right"} size={12} className={styles.rowIcon} />
      {row.depth > 0 && <Icon name="folder" size={14} className={styles.rowIcon} />}
      <span className={styles.label}>{row.depth > 0 ? row.label : tx(row.label)}</span>
    </span>
  );
}

function BranchRowView({ row }: { row: BranchRow | Extract<RepoRow, { type: "action" | "branch" | "tag" }> }) {
  const indent = "depth" in row && row.depth ? { paddingLeft: row.depth * INDENT } : undefined;
  if (row.type === "action") {
    const keys = shortcutLabel(row.action.id);
    return (
      <span className={styles.row} data-row-key={row.key}>
        {row.action.checked === false ? (
          <span className={styles.rowIcon} style={{ width: 14 }} />
        ) : (
          <Icon
            name={row.action.checked ? "check" : (row.action.icon ?? "more")}
            size={14}
            className={styles.rowIcon}
          />
        )}
        <HighlightedText className={styles.label} text={tx(row.action.label)} indices={row.matches} tone="accent" />
        {keys && <span className={styles.keys}>{keys}</span>}
      </span>
    );
  }
  if (row.type === "tag") {
    return (
      <span className={styles.row} data-row-key={row.key} style={indent}>
        <Icon name="tag" size={14} className={styles.rowIcon} />
        <HighlightedText
          className={clsx(styles.label, styles.branchName)}
          text={row.tag}
          indices={row.matches}
          tone="accent"
        />
        <Icon name="chevron-right" size={10} className={styles.chevron} />
      </span>
    );
  }
  if (row.type !== "branch") return null;
  const b = row.branch;
  return (
    <span className={styles.row} data-row-key={row.key} style={indent}>
      {b.current ? (
        <Icon name="current-branch" size={14} className={clsx(styles.rowIcon, styles.currentIcon)} />
      ) : (
        // Like IDEA: favorites show a star; others show an empty star on hover. Click toggles.
        <button
          type="button"
          className={clsx(styles.star, row.favorite && styles.starOn)}
          aria-label={row.favorite ? tx("Remove from Favorites") : tx("Add to Favorites")}
          aria-pressed={row.favorite}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavoriteBranch(b);
          }}
        >
          <Icon name={row.favorite ? "star" : "star-outline"} size={14} className={styles.starIcon} />
          {!row.favorite && <Icon name="branch" size={14} className={styles.branchIcon} />}
        </button>
      )}
      <HighlightedText
        className={clsx(styles.label, styles.branchName, b.current && styles.current)}
        text={row.label}
        indices={row.matches}
        tone="accent"
      />
      {b.current && (
        <span className={styles.tag}>
          <T>current</T>
        </span>
      )}
      <BranchSync behind={b.behind} ahead={b.ahead} />
      {!b.remote && b.upstream && <span className={styles.upstream}>{b.upstream}</span>}
      <Icon name="chevron-right" size={10} className={styles.chevron} />
    </span>
  );
}
