/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { mockOmnitermAPI } from "../../testUtils";
import App from "../../App";
import { TOKYO_NIGHT } from "../../themes";

describe("App", () => {
  beforeEach(() => {
    mockOmnitermAPI({
      settings: {
        get: async () => ({ themeId: "tokyo-night", fontSize: 14, smartColors: true, checkUpdatesOnStartup: true, darkMode: true, shortcuts: {} }),
      },
      themes: {
        list: async () => [TOKYO_NIGHT],
      },
    });
    localStorage.clear();
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    } as unknown as typeof ResizeObserver;
  });

  it("opens directly into the terminal workspace with no login", async () => {
    render(<App />);
    // The workspace (MainLayout) renders straight away — no master-password gate.
    await waitFor(() => expect(screen.getByText(/Open a terminal/i)).toBeInTheDocument());
    expect(screen.queryByPlaceholderText("Master password")).not.toBeInTheDocument();
    expect(screen.queryByText("Local Vaults")).not.toBeInTheDocument();
  });

  it("loads stored settings and themes on mount", async () => {
    const settingsGet = vi.fn(async () => ({ themeId: "tokyo-night", fontSize: 16, smartColors: true, checkUpdatesOnStartup: false, darkMode: true, shortcuts: {} }));
    const themesList = vi.fn(async () => [TOKYO_NIGHT]);
    mockOmnitermAPI({
      settings: { get: settingsGet },
      themes: { list: themesList },
    });
    render(<App />);
    await waitFor(() => expect(settingsGet).toHaveBeenCalled());
    await waitFor(() => expect(themesList).toHaveBeenCalled());
  });
});
