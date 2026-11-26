/**
 * Settings (⌘,): search + page tree on the left, page host with breadcrumb and
 * scope switch on the right, OK / Cancel / Apply below (macOS: Cancel / Apply / OK).
 *
 * `SettingsLayout` renders inside `SettingsDialog`, the in-app modal over the workbench.
 */
import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useProject } from "@/platform/project";
import { SettingsFormContext, useSettingsPages, type SettingsPageContribution } from "@/workbench/contributions";
import {
  Checkbox,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  SearchField,
  Spinner,
  SplitGroup,
  SplitHandle,
  SplitPanel,
  type DialogButton,
  T,
} from "@/ui";
import { PageContext, useSettingsFormFor } from "../components/context";
import { SearchLabel } from "../components/Form";
import { breadcrumb, buildPageTree, filterPageTree, flatten, groupKey, type PageNode } from "../model/pages";
import { hasSimpleView, setSimpleView, simplePageTree, useSimpleView } from "../model/simpleView";
import {
  applySettings,
  closeSettings,
  pendingChanges,
  resetPage,
  selectPage,
  setPageScope,
  setQuery,
  settingsTitle,
  SSH_SETTINGS_PAGE,
  useSettingsDialog,
  type Scope,
} from "../model/staging";
import { builtinSpec, pageLabels } from "../pages/registry";
import { PageErrorBoundary } from "./PageErrorBoundary";
import { SettingsTree, type SettingsTreeHandle } from "./SettingsTree";
import styles from "./SettingsDialog.module.css";
import { tx } from "@/platform/i18n";

/** Keys of the nodes above `key`, root first. */
function ancestorKeys(nodes: readonly PageNode[], key: string): string[] {
  for (const n of nodes) {
    if (n.key === key) return [];
    const sub = ancestorKeys(n.children, key);
    if (sub.length || n.children.some((c) => c.key === key)) return [n.key, ...sub];
  }
  return [];
}

function firstPage(nodes: readonly PageNode[]): string | null {
  const list = flatten(nodes).filter((n) => n.page);
  return (list.find((n) => n.matched) ?? list[0])?.key ?? null;
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  "Appearance & Behavior":
    "Customize IDE appearance and behavior: change themes and font size, configure system settings and notifications.",
  Editor: "Configure code editing: completion, folding, tabs, fonts, colors, code style and inspections.",
  "Build, Execution, Deployment": "Configure build tools, run configurations, debugger and deployment.",
  "Languages & Frameworks": "Configure language servers, interpreters, SDKs and framework support.",
  Agents: "Install coding agents and configure how they launch, chat and connect to the IDE.",
  Tools: "Configure external tools, terminal, database and other integrations.",
  "Version Control": "Configure the settings related to version control used in your project",
};

function GroupPage({ node }: { node: PageNode }) {
  const description = GROUP_DESCRIPTIONS[node.title];
  return (
    <div className={styles.groupPage}>
      {description && (
        <p className={styles.groupDescription}>
          <T>{description}</T>
        </p>
      )}
      <div className={styles.groupLinks}>
        {node.children.map((c) => (
          <button key={c.key} type="button" className={styles.groupLink} onClick={() => selectPage(c.key)}>
            <SearchLabel text={c.title} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ScopeSwitch({ pageId, scope }: { pageId: string; scope: Scope }) {
  const options: Array<[Scope, string]> = [
    ["global", "Global"],
    ["project", "This project"],
  ];
  return (
    <div className={styles.scope} role="radiogroup" aria-label={tx("Settings scope")}>
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={scope === value}
          className={clsx(styles.scopeButton, scope === value && styles.scopeOn)}
          onClick={() => setPageScope(pageId, value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PageHost({
  node,
  page,
  crumbs,
  dirty,
  onReset,
  history,
}: {
  node: PageNode | undefined;
  page: SettingsPageContribution | undefined;
  crumbs: string[];
  dirty: boolean;
  onReset: () => void;
  history: { back?: () => void; forward?: () => void };
}) {
  const pageId = node?.key ?? "";
  const hasProject = useProject((s) => !!s.project);
  const newProjects = useSettingsDialog((s) => s.newProjects);
  const spec = page ? builtinSpec(page.id) : undefined;
  const projectScope = !!(spec?.projectScope ?? page?.projectScope) && hasProject && !newProjects;
  const scopeKey = spec?.scopeGroup ?? pageId;
  const chosen = useSettingsDialog((s) => s.scopes[scopeKey]) ?? spec?.defaultScope;
  const scope: Scope = projectScope && chosen === "project" ? "project" : "global";
  // Where a project value is the norm, say what the global one is for.
  const globalNote = newProjects || (projectScope && scope === "global" && spec?.defaultScope === "project");
  const ctx = useMemo(() => ({ pageId, scope }), [pageId, scope]);
  const form = useSettingsFormFor(pageId, scope);
  if (!node) return <EmptyState title="Nothing found" icon="search" />;
  const Body = page?.component;
  return (
    <PageContext.Provider value={ctx}>
      <SettingsFormContext.Provider value={form}>
        <div className={styles.pageHeader}>
          {/* Prototype `.sp-head`: the page title, then its parent path in muted text. */}
          <div className={styles.crumbs} aria-label={tx("Breadcrumb")}>
            <span className={styles.pageTitle}>
              <T>{crumbs[crumbs.length - 1] ?? ""}</T>
            </span>
            {crumbs.length > 1 && (
              <span className={styles.crumb}>{crumbs.slice(0, -1).map((c) => tx(c)).join(" › ")}</span>
            )}
          </div>
          {dirty && (
            <button type="button" className={styles.reset} onClick={onReset}>
              <T>Reset</T>
            </button>
          )}
          {projectScope && !spec?.ownScopeSwitch && <ScopeSwitch pageId={scopeKey} scope={scope} />}
          <span className={styles.history}>
            <IconButton icon="arrow-left" title="Back" size="small" disabled={!history.back} onClick={history.back} />
            <IconButton
              icon="arrow-right"
              title="Forward"
              size="small"
              disabled={!history.forward}
              onClick={history.forward}
            />
          </span>
        </div>
        {scope === "project" && (
          <div className={styles.scopeNote}>
            <Icon name="info" size={14} />
            <T>Saved to .omniterm/settings.toml in this project; overrides the global value.</T>
          </div>
        )}
        {globalNote && (
          <div className={styles.scopeNote}>
            <Icon name="info" size={14} />
            <T>Saved to the global settings: used by new projects and by projects without their own value.</T>
          </div>
        )}
        <div className={styles.pageBody}>
          <PageErrorBoundary pageId={pageId}>{Body ? <Body /> : <GroupPage node={node} />}</PageErrorBoundary>
        </div>
      </SettingsFormContext.Provider>
    </PageContext.Provider>
  );
}

export function SettingsDialog() {
  const open = useSettingsDialog((s) => s.open);
  if (!open) return null;
  return <SettingsDialogInner />;
}

function useSettingsTitle(): string {
  return useSettingsDialog((s) => settingsTitle(s.newProjects));
}

function SettingsDialogInner() {
  return (
    <Dialog
      open
      onClose={closeSettings}
      title={useSettingsTitle()}
      width={980}
      className={styles.dialog}
      footerStart={<SettingsStatus />}
      buttons={useSettingsButtons()}
    >
      <SettingsLayout />
    </Dialog>
  );
}

/** Page tree + current page; reads the shared settings staging store. */
function SettingsLayout() {
  const pages = useSettingsPages((s) => s.pages);
  const { pageId, query, staged, stagedSecrets, stagedExternal, saving, pagesLoading } = useSettingsDialog();
  const treeRef = useRef<SettingsTreeHandle>(null);

  const fullTree = useMemo(() => buildPageTree(pages.values()), [pages]);
  // OmniTerm: the simple view lists the everyday pages; a search still looks through all of them.
  const simple = useSimpleView((v) => v.simple) && hasSimpleView();
  const narrowed = simple && !query.trim();
  const tree = useMemo(
    () => (narrowed ? simplePageTree(fullTree, pageId ?? undefined) : fullTree),
    [fullTree, narrowed, pageId],
  );
  const filtered = useMemo(() => filterPageTree(tree, query, pageLabels), [tree, query]);
  const all = useMemo(() => flatten(tree), [tree]);

  const current = all.find((n) => n.key === pageId) ?? all.find((n) => n.page);
  const crumbs = current ? breadcrumb(tree, current.key) : [];
  const dirtyPages = useMemo(() => {
    const pages = new Set(Object.values(staged).map((c) => c.page));
    if (Object.keys(stagedSecrets).length) pages.add(SSH_SETTINGS_PAGE);
    for (const c of Object.values(stagedExternal)) pages.add(c.page);
    return pages;
  }, [staged, stagedSecrets, stagedExternal]);
  const pageDirty = !!current && dirtyPages.has(current.key);

  // Back / forward through pages visited while the dialog is open.
  const [nav, setNav] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const currentKey = current?.key;
  if (currentKey && nav.stack[nav.index] !== currentKey) {
    const stack = [...nav.stack.slice(0, nav.index + 1), currentKey];
    setNav({ stack, index: stack.length - 1 });
  }
  const go = (index: number) => {
    setNav((n) => ({ ...n, index }));
    selectPage(nav.stack[index]!);
  };
  const history = {
    back: nav.index > 0 ? () => go(nav.index - 1) : undefined,
    forward: nav.index < nav.stack.length - 1 ? () => go(nav.index + 1) : undefined,
  };

  const onQuery = (q: string) => {
    setQuery(q);
    const next = flatten(filterPageTree(q.trim() ? fullTree : tree, q, pageLabels));
    if (q && current && !next.some((n) => n.key === current.key && n.matched)) {
      const first = firstPage(next);
      if (first) selectPage(first);
    }
  };

  if (pagesLoading) {
    return (
      <div className={styles.layout}>
        <div className={styles.loading}>
          <Spinner size={16} /> <T>Loading…</T>
        </div>
      </div>
    );
  }

  return (
    <SplitGroup id="settings" orientation="horizontal" storageKey="omniterm.settings.layout" className={styles.layout}>
      <SplitPanel id="navigation" defaultSize="270px" minSize="160px" maxSize="40%" className={styles.sidebar}>
        <SearchField
          data-autofocus
          className={styles.search}
          value={query}
          onChange={onQuery}
          placeholder={tx("Search settings")}
          aria-label="Search settings"
          onKeyDown={(e) => {
            // IDEA: Esc clears the filter before it closes the dialog; ↑/↓ move through the pages, focus stays here.
            if (e.key === "Escape" && query) {
              e.preventDefault();
              e.stopPropagation();
              onQuery("");
            } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              treeRef.current?.moveSelection(e.key === "ArrowDown" ? 1 : -1);
            }
          }}
        />
        {hasSimpleView() && (
          <Checkbox
            className={styles.simple}
            checked={!simple}
            onChange={(showAll) => setSimpleView(!showAll)}
            label="Show advanced settings"
          />
        )}
        <div className={styles.tree}>
          <SettingsTree
            handleRef={treeRef}
            roots={filtered}
            counts={tree}
            selected={current?.key}
            ancestors={current ? ancestorKeys(tree, current.key) : []}
            searching={!!query.trim()}
            dirty={dirtyPages}
            onSelect={selectPage}
          />
        </div>
      </SplitPanel>
      <SplitHandle aria-label={tx("Settings pages")} />
      <SplitPanel id="content" minSize="60%" className={styles.main}>
        <PageHost
          node={current}
          page={current?.page}
          crumbs={crumbs}
          dirty={pageDirty && !saving}
          onReset={() => current && resetPage(current.key)}
          history={history}
          key={current?.key ?? groupKey("")}
        />
      </SplitPanel>
    </SplitGroup>
  );
}

/** OK / Cancel / Apply, ordered per platform by the dialog primitive. */
function useSettingsButtons(): DialogButton[] {
  const { staged, stagedSecrets, stagedExternal, base, globalBase, saving } = useSettingsDialog();
  const pending = useMemo(() => pendingChanges({ base, globalBase, staged }).length > 0, [base, globalBase, staged]);
  const ok = async () => {
    if (await applySettings()) closeSettings();
  };
  return [
    { label: "OK", role: "default", disabled: saving, onClick: () => void ok() },
    { label: "Cancel", role: "cancel", onClick: closeSettings },
    {
      label: "Apply",
      disabled: (!pending && !Object.keys(stagedSecrets).length && !Object.keys(stagedExternal).length) || saving,
      onClick: () => void applySettings(),
    },
  ];
}

function SettingsStatus() {
  const error = useSettingsDialog((s) => s.error);
  return (
    <span className={styles.footerStatus} role="status">
      {error && (
        <span className={styles.error}>
          <Icon name="error" size={14} /> {tx`Could not save: ${error}`}
        </span>
      )}
    </span>
  );
}
