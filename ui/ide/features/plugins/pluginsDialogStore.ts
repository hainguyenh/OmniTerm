/**
 * The Plugins dialog (IDEA's File › Settings › Plugins as its own window): one list of every
 * plugin, split into Marketplace and Installed. The IDE extensions (Wasm, `plugin.toml`) are listed
 * by the dialog itself; the host adds its own plugins (OmniTerm's Node plugins) and names the IDE
 * plugins it ships with `registerHostPluginSource`, so the Installed list can mark what is built in.
 */
import { type ComponentType, useSyncExternalStore } from "react";
import { create } from "zustand";

/** A plugin of the host's own plugin system, shown as a row of the Installed list. */
export interface HostPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  /** Ships with the app (cannot be uninstalled), as opposed to installed by the user. */
  builtin: boolean;
  /** Why it is not running, when it failed to load. */
  error?: string;
}

export interface HostPluginSource {
  /** The host's plugins now; the same array until they change. */
  plugins(): readonly HostPlugin[];
  /** Calls `listener` whenever `plugins()` changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** The details pane of one of the host's plugins. */
  Details: ComponentType<{ id: string }>;
  /** Ids of the IDE plugins the app ships and keeps installed. */
  builtinPluginIds: readonly string[];
  /** Installs one of the host's plugin packages chosen by the user (gear menu). */
  installPackage?: { label: string; run(): Promise<{ name: string; restartRequired: boolean } | null>; restart(): void };
}

interface PluginsDialogState {
  open: boolean;
  source: HostPluginSource | null;
}

export const usePluginsDialog = create<PluginsDialogState>(() => ({ open: false, source: null }));

export function openPluginsDialog(): void {
  usePluginsDialog.setState({ open: true });
}

export function closePluginsDialog(): void {
  usePluginsDialog.setState({ open: false });
}

/** Lists the host's plugins in the dialog until the returned disposer runs. */
export function registerHostPluginSource(source: HostPluginSource): () => void {
  usePluginsDialog.setState({ source });
  return () => usePluginsDialog.setState((s) => (s.source === source ? { source: null } : s));
}

const NO_PLUGINS: readonly HostPlugin[] = [];
const noSubscription = () => () => {};

/** The host's plugins, live; none while no host registered a source. */
export function useHostPlugins(source: HostPluginSource | null): readonly HostPlugin[] {
  return useSyncExternalStore(source?.subscribe ?? noSubscription, source?.plugins ?? (() => NO_PLUGINS));
}

/** Whether an IDE plugin ships with the app rather than coming from the marketplace. */
export function isBuiltinPlugin(source: HostPluginSource | null, id: string): boolean {
  return !!source?.builtinPluginIds.includes(id);
}
