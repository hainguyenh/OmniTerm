/**
 * Web browsers (IDEA's Open In › Browser and the editor's browser bar): HTML
 * and SVG files open in an installed browser through the built-in server, and
 * HTML files get a built-in preview beside the editor or a page in its own
 * editor tab. ⌃⇧R in an HTML editor opens the system default browser, like
 * IDEA's Run for HTML files.
 */
import { registerActions } from "@/platform/actions";
import { getContext } from "@/platform/context";
import { basename } from "@/platform/project";
import { lazyComponent, type MenuItem } from "@/ui";
import {
  maybeEditorService,
  registerEditorKind,
  registerMenuGroup,
  registerTextEditorWrapper,
} from "@/workbench/contributions";
import {
  browserIcon,
  isHtmlPath,
  isWebPath,
  loadBrowsers,
  openInBrowser,
  openInEditorTab,
  togglePreview,
  useBrowsers,
  useWebPreview,
  WEB_PAGE_KIND,
  webTabPath,
} from "./browsers";
import { tx } from "@/platform/i18n";

interface OpenArg {
  path?: string;
  browser?: string;
}

function targetPath(arg: unknown): string | null {
  if (typeof arg === "string") return arg;
  const path = (arg as OpenArg | undefined)?.path ?? getContext().editorPath;
  return typeof path === "string" ? path : null;
}

async function showPreview(path: string) {
  await maybeEditorService()?.openFile(path, { focus: true });
  togglePreview(path, true);
}

function browserMenu(path: string): MenuItem {
  const html = isHtmlPath(path);
  return {
    label: "Browser",
    icon: "web",
    submenu: [
      { kind: "action", action: "web.openInBrowser", arg: { path }, label: "System Default Browser" },
      ...(html ? [{ kind: "action" as const, action: "web.openInEditorTab", arg: { path }, label: "Editor Tab" }] : []),
      { kind: "separator" },
      ...(html ? [{ label: "Built-in Preview", icon: "eye", run: () => void showPreview(path) }] : []),
      ...useBrowsers.getState().list.map((b): MenuItem => ({
        label: b.name,
        verbatim: true,
        icon: browserIcon(b.id),
        run: () => void openInBrowser(path, b.id),
      })),
    ],
  };
}

export function activate(): () => void {
  void loadBrowsers();
  const disposers = [
    registerTextEditorWrapper({
      id: "web.html",
      matches: isHtmlPath,
      component: lazyComponent(() => import("./WebEditor").then((m) => m.WebEditor)),
    }),
    registerEditorKind({
      kind: WEB_PAGE_KIND,
      component: lazyComponent(() => import("./WebPageEditor").then((m) => m.WebPageEditor)),
      title: (input) => basename(webTabPath(input) ?? "Page"),
      icon: () => "web",
      restorable: true,
    }),
    registerActions([
      {
        id: "web.openInEditorTab",
        title: "Open in Editor Tab",
        description: "Open the HTML file served by the built-in server in an editor tab",
        category: "View",
        icon: "web",
        when: "projectOpen",
        keywords: ["browser", "html", "preview", "page", "tab", "local server"],
        run: ({ arg }) => {
          const path = targetPath(arg);
          if (path && isHtmlPath(path)) return openInEditorTab(path);
        },
      },
      {
        id: "web.openInBrowser",
        title: "Open in Browser",
        description: "Open the HTML or SVG file in the system default browser through the built-in server",
        category: "View",
        icon: "web",
        when: "projectOpen",
        keyWhen: "textEditorActive && editorLangId == html",
        keywords: ["browser", "html", "preview", "chrome", "firefox", "safari", "run"],
        run: ({ arg }) => {
          const path = targetPath(arg);
          if (path && isWebPath(path)) return openInBrowser(path, (arg as OpenArg | undefined)?.browser ?? null);
        },
      },
      {
        id: "web.togglePreview",
        title: "Built-in Preview",
        description: "Show the HTML file rendered beside the editor",
        category: "View",
        icon: "eye",
        when: "textEditorActive && editorLangId == html",
        keywords: ["browser", "html", "preview", "live"],
        toggled: () => {
          const path = getContext().editorPath;
          return typeof path === "string" && !!useWebPreview.getState()[path];
        },
        run: ({ arg }) => {
          const path = targetPath(arg);
          if (path && isHtmlPath(path)) togglePreview(path);
        },
      },
    ]),
    registerMenuGroup({
      id: "web.open",
      menus: ["editor", "editorTab", "projectView"],
      order: 5,
      items: (_menu, { paths, dirs }) => {
        const path = paths.length === 1 && !dirs?.[0] ? paths[0]! : null;
        if (!path || !isHtmlPath(path)) return [];
        return [
          {
            kind: "action",
            action: "web.openInBrowser",
            arg: { path },
            label: tx`Open '${basename(path)}' in Browser`,
            icon: "external-link",
          },
          {
            kind: "action",
            action: "web.openInEditorTab",
            arg: { path },
            label: tx`Open '${basename(path)}' in Editor Tab`,
            icon: "web",
          },
        ];
      },
    }),
    registerMenuGroup({
      id: "web.openIn",
      menus: ["openIn"],
      items: (_menu, { paths, dirs }) =>
        paths.length === 1 && !dirs?.[0] && isWebPath(paths[0]!) ? [browserMenu(paths[0]!)] : [],
    }),
  ];
  return () => disposers.reverse().forEach((d) => d());
}
