/**
 * Settings: the Settings dialog (⌘,, action `file.settings`) with built-in
 * pages (Appearance, System Settings, Keymap, Editor › General / Font / Code
 * Style / Files) plus pages contributed via `registerSettingsPage`, and the
 * runtime application of keymap / UI font size / high-contrast settings.
 *
 * Settings open as an in-app modal dialog over the workbench (UI specification).
 *
 * `executeAction("file.settings", "keymap")` opens a specific page;
 * `file.newProjectsSettings` (IDEA's Settings for New Projects) edits the
 * global layer only, which new projects inherit.
 */
import { registerActions, type Action } from "@/platform/actions";
import { lazyWhen } from "@/ui";
import { provideSettingsSearchIndex, registerOverlay } from "@/workbench/contributions";
import {
  LazyProjectStructureDialog,
  LazySettingsDialog,
  loadBuiltinPages,
  unloadBuiltinPages,
} from "./dialog/LazySettingsDialog";
import { openProjectStructure, openSettings } from "./model/staging";
import { appearanceToggleActions, navigationBarActions, zoomActions } from "./appearanceRuntime";
import { activateFileTypes } from "./fileTypesRuntime";
import { trackRuntimeSettings } from "./runtime";
import { showAssignShortcut, useAssignShortcut } from "./keymap/assignShortcutStore";
import { settingsSearchEntries } from "./searchIndex";
import { activatePythonStatus } from "./languages/PythonStatus";
import { activatePhpStatus } from "./languages/PhpStatus";
import { nativeToAsciiAction } from "./nativeToAscii";
import { trackIconThemePages } from "./iconThemePages";

/** Settings-driven runtime state (zoom, fonts, theme) of a secondary window. */
export const activateRuntimeSettings = trackRuntimeSettings;

/** Java's page first: JDK, Maven and the language server are what new projects most often need. */
const NEW_PROJECTS_PAGE = "languages.java";

function settingsActions(open: (page?: string, newProjects?: boolean) => void): Action[] {
  return [
    nativeToAsciiAction(),
    {
      id: "file.settings",
      title: "Settings…",
      category: "File",
      icon: "settings",
      keywords: ["preferences", "options", "configure"],
      run: ({ arg }) => open(typeof arg === "string" ? arg : undefined),
    },
    {
      id: "file.newProjectsSettings",
      title: "Settings for New Projects…",
      category: "File",
      icon: "settings",
      keywords: ["new projects setup", "default settings", "default project", "default jdk", "global settings"],
      run: ({ arg }) => open(typeof arg === "string" ? arg : NEW_PROJECTS_PAGE, true),
    },
    {
      id: "settings.keymap",
      title: "Keymap…",
      category: "File",
      icon: "keyboard",
      keywords: ["shortcuts", "keyboard", "bindings"],
      run: () => open("keymap"),
    },
    {
      id: "settings.appearance",
      title: "Appearance…",
      category: "View",
      icon: "sun",
      keywords: ["theme", "accent", "font size"],
      run: () => open("appearance"),
    },
  ];
}

/** Opens the Settings dialog, on `page` when given. */
async function showSettings(page?: string, newProjects = false) {
  await loadBuiltinPages();
  openSettings(page, { newProjects });
}

const useAssignShortcutOpen = () => useAssignShortcut((s) => s.actionId !== null);

export function activate(): () => void {
  const disposers = [
    trackRuntimeSettings(),
    trackIconThemePages(),
    activatePythonStatus(),
    activatePhpStatus(),
    unloadBuiltinPages,
    registerOverlay({ id: "settings.dialog", component: LazySettingsDialog }),
    registerOverlay({ id: "settings.projectStructure", component: LazyProjectStructureDialog }),
    registerActions(zoomActions()),
    registerActions(appearanceToggleActions()),
    registerActions(navigationBarActions()),
    registerActions(settingsActions((page, newProjects) => void showSettings(page, newProjects))),
    registerActions([
      {
        id: "file.projectStructure",
        title: "Project Structure…",
        category: "File",
        icon: "folder",
        keywords: ["project structure", "sdk", "jdk", "modules", "libraries", "facets", "artifacts", "sources"],
        run: ({ arg }) => openProjectStructure(typeof arg === "string" ? arg : undefined),
      },
    ]),
    activateFileTypes(),
    registerOverlay({
      id: "settings.assignShortcut",
      component: lazyWhen(useAssignShortcutOpen, () =>
        import("./keymap/AssignShortcut").then((m) => m.AssignShortcutOverlay),
      ),
    }),
    registerActions([
      {
        // Search Everywhere's ⌥↵ on an action (arg: the action id).
        id: "settings.assignShortcut",
        title: "Assign Shortcut…",
        category: "Settings",
        hidden: true,
        run: ({ arg }) => {
          if (typeof arg === "string") showAssignShortcut(arg);
        },
      },
    ]),
    provideSettingsSearchIndex(settingsSearchEntries),
  ];
  return () => disposers.reverse().forEach((d) => d());
}
