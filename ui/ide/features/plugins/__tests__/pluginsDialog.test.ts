import { afterEach, describe, expect, it } from "vitest";
import {
  type HostPluginSource,
  closePluginsDialog,
  isBuiltinPlugin,
  openPluginsDialog,
  registerHostPluginSource,
  usePluginsDialog,
} from "../pluginsDialogStore";

const source = (builtinPluginIds: string[]): HostPluginSource => ({
  plugins: () => [],
  subscribe: () => () => {},
  setEnabled: async () => {},
  Details: () => null,
  builtinPluginIds,
});

afterEach(() => usePluginsDialog.setState({ open: false, source: null }));

describe("the Plugins dialog", () => {
  it("opens and closes", () => {
    openPluginsDialog();
    expect(usePluginsDialog.getState().open).toBe(true);
    closePluginsDialog();
    expect(usePluginsDialog.getState().open).toBe(false);
  });

  it("marks the IDE plugins the host ships as built in", () => {
    expect(isBuiltinPlugin(null, "omniterm.todo-finder")).toBe(false);
    const dispose = registerHostPluginSource(source(["omniterm.todo-finder"]));
    const { source: shown } = usePluginsDialog.getState();
    expect(isBuiltinPlugin(shown, "omniterm.todo-finder")).toBe(true);
    expect(isBuiltinPlugin(shown, "omniterm.git-toolbox")).toBe(false);
    dispose();
    expect(usePluginsDialog.getState().source).toBeNull();
  });

  it("a stale disposer does not remove the source registered after it", () => {
    const first = registerHostPluginSource(source([]));
    const second = source(["a"]);
    registerHostPluginSource(second);
    first();
    expect(usePluginsDialog.getState().source).toBe(second);
  });
});
