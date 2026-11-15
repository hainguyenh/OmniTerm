import { pluginLanguageVisuals } from "./languageVisuals";
/**
 * Plugins: the Plugins dialog and Settings › Plugins (installed list, enable/disable,
 * install from disk with a permission page, uninstall, theme selection) and the runtime
 * bridge to the plugin host (`ide_host::plugins`): UI contributions are
 * projected by `projection.ts` / `points.tsx`.
 *
 * Actions: `plugins.settings`, `plugins.installFromDisk`, `plugins.reloadAll`,
 * plus one action per plugin command: `plugin.<pluginId>.<commandId>`
 * (searchable in Search Everywhere › Actions and bindable in the keymap editor;
 * a string arg is forwarded to the plugin).
 *
 * Editor contribution `plugins.lineMarkers`: gutter icons from plugin
 * `line-markers` providers (`lineMarkerGutter.ts`).
 */
import { registerEditorContribution } from "@/editor/api";
import { lazyComponent } from "@/ui";
import { registerActions } from "@/platform/actions";
import { useProject } from "@/platform/project";
import { editorService, registerOverlay, registerSettingsPage } from "@/workbench/contributions";
import {
  followPluginChanges,
  providePluginThemePreviews,
  startPluginBridge,
  syncProjection,
  trackPluginTheme,
} from "./bridge";
import { ConsentDialogHost, provideConsentDialog } from "./consent";
import { PluginsDialog } from "./PluginsDialog";
import { openPluginsDialog } from "./pluginsDialogStore";
import { trackIconTheme } from "./iconThemes";
import { pluginLineMarkerGutter } from "./lineMarkerGutter";
import { defineBuiltinUiPoints } from "./points";
import { startViewUi } from "./uiPoints";
import { startWorkspaceContains } from "./workspaceContains";
import { startPluginDecorations } from "./decorations";
import { startIndexedMarkers } from "./indexedMarkers";
import { startRunTargets } from "./runTargets";
import { startPluginNavigation } from "./navigation";
import {
  installFromDisk,
  PLUGINS_GROUP_PAGE_ID,
  refreshPlugins,
  reloadPlugin,
  SETTINGS_PAGE_ID,
  updateAllPlugins,
  usePlugins,
} from "./store";

function registerPluginsPage(): () => void {
  const disposers = [
    // A folder (no page of its own): OmniTerm puts its Node plugins first, then the extensions.
    registerSettingsPage({ id: PLUGINS_GROUP_PAGE_ID, title: "Plugins", order: 250, keywords: ["plugin"] }),
    registerSettingsPage({
      id: SETTINGS_PAGE_ID,
      title: "Extensions",
      order: 50,
      keywords: ["plugin", "extension", "wasm", "install", "theme", "marketplace", "plugin.toml"],
      component: lazyComponent(() => import("./PluginsPage").then((m) => m.PluginsPage)),
    }),
  ];
  return () => disposers.forEach((dispose) => dispose());
}

/** Settings › Plugins for the Settings window: the page plus the plugin theme. */
export function activateSettingsPages(): () => void {
  const disposers = [
    registerPluginsPage(),
    registerOverlay({ id: "plugins.consent", component: ConsentDialogHost }),
    provideConsentDialog(),
    defineBuiltinUiPoints(),
    followPluginChanges(),
    startRunTargets(false),
    syncProjection(),
    trackPluginTheme(),
    trackIconTheme(),
  ];
  void refreshPlugins();
  return () => disposers.reverse().forEach((d) => d());
}

export function activate(): () => void {
  const disposers = [
    registerPluginsPage(),
    registerOverlay({ id: "plugins.dialog", component: PluginsDialog }),
    registerOverlay({ id: "plugins.consent", component: ConsentDialogHost }),
    provideConsentDialog(),
    providePluginThemePreviews(),
    registerActions([
      {
        id: "plugins.settings",
        title: "Plugins…",
        category: "Plugins",
        icon: "plugin",
        keywords: ["extensions", "manage plugins", "install plugin", "enable plugin", "disable plugin"],
        // A tab id opens that tab (`extensions`, or a host's own plugin system).
        run: () => openPluginsDialog(),
      },
      {
        id: "plugins.installFromDisk",
        title: "Install Plugin from Disk…",
        category: "Plugins",
        icon: "plugin",
        keywords: ["extension", "wasm", "plugin.toml"],
        run: async ({ arg }) => {
          await installFromDisk(typeof arg === "string" ? arg : undefined);
        },
      },
      {
        id: "plugins.updateAll",
        title: "Update All Plugins",
        category: "Plugins",
        icon: "plugin",
        keywords: ["upgrade", "marketplace", "new version"],
        run: async () => {
          await updateAllPlugins();
        },
      },
      {
        id: "plugins.reloadAll",
        title: "Reload Plugins",
        category: "Plugins",
        icon: "refresh",
        keywords: ["dev plugin", "rebuild"],
        run: async () => {
          const ids = usePlugins.getState().plugins.map((p) => p.id);
          for (const id of ids) await reloadPlugin(id);
        },
      },
    ]),
    startPluginBridge(),
    startPluginNavigation(),
    startIndexedMarkers(),
    startPluginDecorations(),
    // Plugin custom editors (tab kind) and context menu entries.
    startViewUi((input) => void editorService().openInput(input)),
    startWorkspaceContains(),
    // Gutter icons from plugins' `line-markers` providers (next to the LSP ones).
    registerEditorContribution({ id: "plugins.languageFeatures", order: 58, extensions: pluginLanguageVisuals }),
    registerEditorContribution({ id: "plugins.lineMarkers", order: 57, extensions: pluginLineMarkerGutter }),
    // Dev plugins (`<project>/.omniterm/plugins`) depend on the open project.
    useProject.subscribe((s, prev) => {
      if (s.project?.root !== prev.project?.root || s.project?.trusted !== prev.project?.trusted) void refreshPlugins();
    }),
  ];
  void refreshPlugins();
  return () => disposers.reverse().forEach((d) => d());
}
