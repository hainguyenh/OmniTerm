/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { mockOmnitermAPI } from "../../testUtils";
import { TOKYO_NIGHT } from "../../themes";
import MainLayout from "../MainLayout";

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
  },
};

function renderLayout(props = {}, overrides = {}) {
  mockOmnitermAPI({
    plugin: {
      list: async () => [{
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        apiVersion: 2,
        hostVersion: '1.0.0',
        permissions: ['connections'],
        source: 'bundled',
        enabled: true,
        status: 'loaded',
        activeConnectionProvider: true,
        selectedConnectionProvider: true,
        activeAuthProvider: false,
        activeInvokeHandler: false,
      }],
    },
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
    ...render(<MainLayout appSettings={baseSettings} currentTheme={TOKYO_NIGHT} layoutMode={1} settingsOpen={false} updateState={null} {...handlers} {...props} />),
  };
}

describe("MainLayout", () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    } as unknown as typeof ResizeObserver;
  });

  /** A workspace is the only home for connections now — there is no separate personal section. */
  it("renders the empty sidebar state with no personal connections section", async () => {
    renderLayout();
    await waitFor(() => expect(screen.getByText(/No workspaces yet/i)).toBeInTheDocument());
    expect(screen.queryByLabelText("Personal Connections")).not.toBeInTheDocument();
    expect(screen.queryByTitle("New personal connection")).not.toBeInTheDocument();
  });

  it("opens the connection form against the workspace folder that asked for it", async () => {
    const WS = { id: "ws#1", name: "my-project", folders: [{ id: "folder#1", name: "my-project", path: "C:/proj" }], order: 0, pins: [] };
    renderLayout({}, {
      workspace: {
        list: async () => [WS],
        scanFolders: async () => [
          { id: "folder#1", name: "my-project", path: "folder#1", isDir: true, kind: "dir" },
          { id: "folder#1/infra", name: "infra", path: "folder#1/infra", isDir: true, kind: "dir" },
        ],
        scanFolderEntries: async (_workspaceId: string, folder: string) => {
          const entries = folder === "folder#1/infra"
            ? [{ id: "folder#1/infra/up.sh", name: "up.sh", path: "folder#1/infra/up.sh", isDir: false, kind: "sh", editable: true }]
            : [];
          return { entries, total: entries.length, hasMore: false };
        },
        loadConnections: async () => [],
      },
    });
    fireEvent.click(await screen.findByText("my-project"));
    fireEvent.click(await screen.findByLabelText("Add connection in infra"));
    expect(await screen.findByRole("heading", { name: "New Connection" })).toBeInTheDocument();
    expect(screen.getAllByText("my-project", { selector: "span.text-xs" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    const parentSelect = screen.getByRole("combobox");
    expect(parentSelect).toHaveValue("folder#1/infra");
    expect(screen.getByRole("option", { name: "my-project" })).toHaveValue("folder#1");
    expect(Array.from((parentSelect as HTMLSelectElement).options).some(option => option.value === "")).toBe(false);
  });

  it("uses the Workspace header plus only to add a workspace", async () => {
    const add = vi.fn().mockResolvedValue(null);
    renderLayout({}, { workspace: { add } });
    await waitFor(() => expect(screen.getByText(/No workspaces yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Add workspace folder"));
    expect(add).toHaveBeenCalledOnce();
    expect(screen.queryByText("New connection")).not.toBeInTheDocument();
  });
});
