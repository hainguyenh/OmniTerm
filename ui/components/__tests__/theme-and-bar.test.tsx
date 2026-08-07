/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { mockOmnitermAPI } from "../../testUtils";
import { TOKYO_NIGHT } from "../../themes";
import { ThemeRemixModal } from "../ThemeRemixModal";
import { TitleBar } from "../TitleBar";

const baseSettings = {
  themeId: "tokyo-night",
  fontSize: 14,
  smartColors: true,
  checkUpdatesOnStartup: true,
  darkMode: true,
};

describe("ThemeRemixModal", () => {
  beforeEach(() => {
    mockOmnitermAPI();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ThemeRemixModal isOpen={false} onClose={vi.fn()} themes={[TOKYO_NIGHT]} setThemes={vi.fn()} appSettings={baseSettings} setAppSettings={vi.fn()} currentTheme={TOKYO_NIGHT} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the remixer when open", () => {
    render(<ThemeRemixModal isOpen onClose={vi.fn()} themes={[TOKYO_NIGHT]} setThemes={vi.fn()} appSettings={baseSettings} setAppSettings={vi.fn()} currentTheme={TOKYO_NIGHT} />);
    expect(screen.getByText("Theme Remix")).toBeInTheDocument();
    // Every editor section is on screen at once, beside the live preview — no tabs to hunt through.
    expect(screen.getByText("App colors")).toBeInTheDocument();
    expect(screen.getByText("Terminal palette")).toBeInTheDocument();
    expect(screen.getByText("Typography & spacing")).toBeInTheDocument();
    expect(screen.getByText("Live preview")).toBeInTheDocument();
  });

  it("switches dark/light edit mode", () => {
    render(<ThemeRemixModal isOpen onClose={vi.fn()} themes={[TOKYO_NIGHT]} setThemes={vi.fn()} appSettings={baseSettings} setAppSettings={vi.fn()} currentTheme={TOKYO_NIGHT} />);
    expect(screen.getByTitle("Edit dark variant")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Edit light variant"));
    expect(screen.getByTitle("Edit light variant")).toBeInTheDocument();
  });
});

describe("TitleBar", () => {
  beforeEach(() => {
    mockOmnitermAPI();
    localStorage.clear();
  });

  const renderBar = (props = {}) =>
    render(
      <TitleBar
        appSettings={baseSettings}
        setAppSettings={vi.fn()}
        themes={[TOKYO_NIGHT]}
        onSettingsOpen={vi.fn()}
        setThemeRemixOpen={vi.fn()}
        updateState={null}
        {...props}
      />,
    );

  it("renders window controls and title", async () => {
    renderBar();
    await waitFor(() => expect(screen.getByText("OmniTerm")).toBeInTheDocument());
    expect(screen.getByTitle("Minimize")).toBeInTheDocument();
    expect(screen.getByTitle("Maximize")).toBeInTheDocument();
    expect(screen.getByTitle("Close")).toBeInTheDocument();
  });

  it("shows settings (no auth, always available) and no lock button", () => {
    renderBar();
    expect(screen.getByTitle("Settings")).toBeInTheDocument();
    expect(screen.queryByTitle("Lock vault")).not.toBeInTheDocument();
  });

  it("shows update badge in settings title when update is available", () => {
    renderBar({ updateState: { ...mockUpdateState(), updateAvailable: true } });
    expect(screen.getByTitle("Settings (Update available!)")).toBeInTheDocument();
  });

  it("opens theme picker and lists themes", () => {
    renderBar();
    fireEvent.click(screen.getByTitle("Appearance — theme & font size"));
    expect(screen.getByText("Tokyo Night")).toBeInTheDocument();
    expect(screen.getByText("Theme Remix…")).toBeInTheDocument();
  });

  it("toggles light/dark mode and saves settings", () => {
    const setAppSettings = vi.fn();
    const save = vi.fn();
    mockOmnitermAPI({ settings: { save } });
    renderBar({ appSettings: { ...baseSettings, darkMode: false }, setAppSettings });
    fireEvent.click(screen.getByTitle("Switch to Dark Mode"));
    expect(setAppSettings).toHaveBeenCalledWith({ ...baseSettings, darkMode: true });
  });
});

function mockUpdateState(): UpdateState {
  return {
    current: "1.0.0",
    latest: null,
    latestTag: null,
    latestName: "",
    notes: "",
    htmlUrl: "",
    publishedAt: null,
    updateAvailable: false,
    skippedVersion: null,
    lastCheckAt: null,
    error: null,
    checking: false,
    isPortable: false,
    portableAssetUrl: null,
    installerAssetUrl: null,
    downloadProgress: null,
    downloadStatus: null,
    hasNewerVersion: false,
  };
}
