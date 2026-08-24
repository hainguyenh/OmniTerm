/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MainLayout from "../MainLayout";
import { TOKYO_NIGHT } from "../../themes";
import { mockOmnitermAPI } from "../../testUtils";

const baseSettings: AppSettings = {
  themeId: "tokyo-night",
  fontSize: 14,
  smartColors: true,
  checkUpdatesOnStartup: true,
  darkMode: true,
  shortcuts: {
    zoomIn: "Ctrl+=",
    zoomOut: "Ctrl+-",
    zoomReset: "Ctrl+0",
    newSession: "Ctrl+N",
    newFolder: "Ctrl+Shift+N",
    openSettings: "Ctrl+,",
    toggleThemeMode: "Ctrl+/",
    layout1: "Ctrl+1",
    layout2: "Ctrl+2",
    layout3: "Ctrl+3",
    layout4: "Ctrl+4",
    layout5: "Ctrl+5",
    layout6: "Ctrl+6",
    layout7: "Ctrl+7",
    layout8: "Ctrl+8",
    toggleSidebar: "Ctrl+B",
    commandPalette: "CommandOrControl+P",
    closeTab: "Ctrl+W",
    toggleAppFullscreen: "F11"
  },
};

const updateAvailableState: UpdateState = {
  current: "1.0.0",
  latest: "1.1.0",
  latestTag: "v1.1.0",
  latestName: "1.1.0",
  notes: "",
  htmlUrl: "",
  publishedAt: null,
  updateAvailable: true,
  skippedVersion: null,
  lastCheckAt: null,
  error: null,
  checking: false,
  isPortable: false,
  portableAssetUrl: null,
  installerAssetUrl: "https://example.test/installer.exe",
  downloadProgress: null,
  downloadStatus: null,
  hasNewerVersion: true,
};

function renderLayout(props: any = {}, overrides: any = {}) {
  mockOmnitermAPI({
    settings: { systemExcludedViewExts: vi.fn(async () => []) },
    ...overrides,
  });
  const handlers = {
    setAppSettings: vi.fn(),
    setLayoutMode: vi.fn(),
    setSettingsOpen: vi.fn(),
    setUpdateState: vi.fn(),
    resolveAppearance: vi.fn(() => ({})),
  };

  return {
    handlers,
    ...render(
      <MainLayout
        appSettings={baseSettings}
        currentTheme={TOKYO_NIGHT}
        layoutMode={1}
        settingsOpen={true}
        updateState={updateAvailableState}
        {...handlers}
        {...props}
      />,
    ),
  };
}

describe("MainLayout update UI", () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    } as unknown as typeof ResizeObserver;
  });

  it("shows an error dialog when checking for updates fails", async () => {
    renderLayout(
      { updateState: { ...updateAvailableState, updateAvailable: false, latest: null, latestTag: null, latestName: "", hasNewerVersion: false } },
      {
        updates: {
          check: vi.fn().mockRejectedValue(new Error("network down")),
        },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: /about & updates/i }));
    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));

    await waitFor(() => {
      expect(screen.getByText("Update Check Failed")).toBeInTheDocument();
    });
    expect(screen.getByText(/network down/i)).toBeInTheDocument();
  });

  it("offers installer choices and downloads on-exit installer", async () => {
    const downloadInstaller = vi.fn().mockResolvedValue(undefined);
    renderLayout({}, { updates: { downloadInstaller } });

    fireEvent.click(screen.getByRole("button", { name: /about & updates/i }));
    fireEvent.click(screen.getByRole("button", { name: /install update/i }));
    expect(screen.getByText(/how would you like to install the update/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /on exit/i }));

    await waitFor(() => {
      expect(downloadInstaller).toHaveBeenCalledWith(false);
    });
  });

  /** The update check is available under About & Updates tab. */
  it("shows the update check under About & Updates tab", async () => {
    renderLayout({}, {});
    await waitFor(() => expect(window.omnitermAPI.settings.systemExcludedViewExts).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /about & updates/i }));
    expect(screen.getByRole("button", { name: /install update/i })).toBeInTheDocument();
    expect(screen.getByText(/check on startup/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Advanced$/ })).toBeNull();
  });

  /** The removed encrypted-backup control stays absent even when a connection plugin is loaded. */
  it("never offers an encrypted credential backup, plugin or not", async () => {
    const { unmount } = renderLayout({}, {});
    expect(screen.queryByRole("button", { name: /export encrypted backup/i })).toBeNull();
    unmount();

    renderLayout({}, {
      plugin: {
        list: vi.fn().mockResolvedValue([{
          id: "@omniterm/connection-manager",
          name: "Connection Manager",
          version: "1.0.0",
          apiVersion: 1,
          hostVersion: ">=1.0.0 <2.0.0",
          permissions: ["connections", "openExternal"],
          source: "bundled",
          enabled: true,
          status: "loaded",
          activeConnectionProvider: true,
          activeAuthProvider: false,
          activeInvokeHandler: false,
        }]),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /plugins/i }));
    // Wait for the plugin list to land, so this is not just asserting on an unrendered panel.
    expect(await screen.findByText("Connection Manager")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /export encrypted backup/i })).toBeNull();
  }, 15_000);

  it("no longer advertises the features as always-available badges", async () => {
    renderLayout({}, {});
    await waitFor(() => expect(window.omnitermAPI.settings.systemExcludedViewExts).toHaveBeenCalled());
    for (const badge of ["Encrypted", "Opt-in update check"]) {
      expect(screen.queryByText(badge)).toBeNull();
    }
  });

  /** The picker offers what the host reports, not a hardcoded Windows-shaped list. */
  it("populates the default-terminal picker from the probed shell list", async () => {
    renderLayout({}, {
      shells: {
        list: vi.fn().mockResolvedValue([
          { id: "default", label: "Default login shell" },
          { id: "zsh", label: "Z shell" },
        ]),
      },
    });

    expect(await screen.findByRole("option", { name: "Z shell" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Command Prompt/ })).toBeNull();
  });

  it("lists plugins and disables one through the confirmation flow", async () => {
    const enabledPlugin: PluginDescriptor = {
      id: "@omniterm/connection-manager",
      name: "Connection Manager",
      version: "1.0.0",
      apiVersion: 1,
      hostVersion: ">=1.0.0 <2.0.0",
      permissions: ["connections", "openExternal"],
      source: "bundled",
      enabled: true,
      status: "loaded",
      activeConnectionProvider: true,
      selectedConnectionProvider: true,
      activeAuthProvider: false,
      activeInvokeHandler: false,
    };
    const disabledPlugin = {
      ...enabledPlugin,
      enabled: false,
      status: "disabled" as const,
      activeConnectionProvider: false,
    };
    let currentPlugins = [enabledPlugin];
    const list = vi.fn().mockImplementation(async () => currentPlugins);
    const setEnabled = vi.fn().mockImplementation(async () => {
      currentPlugins = [disabledPlugin];
      return disabledPlugin;
    });
    renderLayout({}, { plugin: { list, setEnabled } });

    fireEvent.click(screen.getByRole("button", { name: /plugins/i }));
    const toggle = await screen.findByRole("switch", { name: /disable connection manager/i });
    fireEvent.click(toggle);
    expect(await screen.findByText("Disable plugin")).toBeInTheDocument();

    const confirmButtons = screen.getAllByRole("button", { name: "Disable" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(setEnabled).toHaveBeenCalledWith("@omniterm/connection-manager", false);
      expect(screen.getByRole("switch", { name: /enable connection manager/i })).toBeInTheDocument();
    });
  });
});
