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

  it("preserves legacy Compact overrides as custom themes in Theme Remix", () => {
    const saved = { ...TOKYO_NIGHT, id: "compact", name: "Saved Compact" };
    render(<ThemeRemixModal isOpen onClose={vi.fn()} themes={[TOKYO_NIGHT, saved]} setThemes={vi.fn()} appSettings={baseSettings} setAppSettings={vi.fn()} currentTheme={TOKYO_NIGHT} />);
    const row = screen.getByText("Saved Compact").closest("button")?.parentElement;
    expect(row).toHaveTextContent("Custom");
  });

  it("switches dark/light edit mode", () => {
    render(<ThemeRemixModal isOpen onClose={vi.fn()} themes={[TOKYO_NIGHT]} setThemes={vi.fn()} appSettings={baseSettings} setAppSettings={vi.fn()} currentTheme={TOKYO_NIGHT} />);
    expect(screen.getByRole("button", { name: "Edit dark variant" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit light variant" }));
    expect(screen.getByRole("button", { name: "Edit light variant" })).toBeInTheDocument();
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
        setThemeRemixOpen={vi.fn()}
        {...props}
      />,
    );

  it("vertically aligns zoom, appearance, font-size, mode and native window controls", () => {
    renderBar({ zoomFactor: 0.8, onZoomReset: vi.fn() });
    const bar = screen.getByTestId("native-titlebar");
    const actions = screen.getByTestId("titlebar-actions");
    const windows = screen.getByTestId("titlebar-window-controls");
    expect(bar).toHaveClass("h-7", "items-center");
    expect(actions).toHaveClass("h-full", "items-center");
    expect(windows).toHaveClass("h-6", "items-center");
    expect(screen.getByText("80%")).toHaveClass("h-6");
    const themeButton = screen.getByRole("button", { name: "Appearance — theme & font size" });
    expect(themeButton).toHaveClass("h-6");
    expect(themeButton.parentElement).toHaveClass("flex", "h-6", "items-center");
    expect(screen.getByLabelText("all terminals").parentElement).toHaveClass("h-6", "items-center");
    expect(screen.getByRole("button", { name: "Switch to Light Mode" })).toHaveClass("h-6");
    for (const label of ["Minimize", "Maximize", "Close"]) {
      expect(screen.getByRole("button", { name: label })).toHaveClass("h-6", "w-8");
    }
  });

  it("renders window controls and title", async () => {
    renderBar();
    await waitFor(() => expect(screen.getByText("OmniTerm")).toBeInTheDocument());
    expect(screen.getByLabelText("Minimize")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximize")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("does not show lock button in title bar", () => {
    renderBar();
    expect(screen.queryByTitle("Lock vault")).not.toBeInTheDocument();
  });

  it("opens theme picker and lists themes", () => {
    renderBar();
    fireEvent.click(screen.getByLabelText("Appearance — theme & font size"));
    expect(screen.getByText("Tokyo Night")).toBeInTheDocument();
    expect(screen.getByText("Theme Remix…")).toBeInTheDocument();
  });

  it("toggles light/dark mode and saves settings", () => {
    const setAppSettings = vi.fn();
    const save = vi.fn();
    mockOmnitermAPI({ settings: { save } });
    renderBar({ appSettings: { ...baseSettings, darkMode: false }, setAppSettings });
    fireEvent.click(screen.getByLabelText("Switch to Dark Mode"));
    expect(setAppSettings).toHaveBeenCalledWith({ ...baseSettings, darkMode: true });
  });
});
