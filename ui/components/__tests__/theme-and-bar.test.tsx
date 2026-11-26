/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { mockOmnitermAPI } from "../../testUtils";
import { TOKYO_NIGHT } from "../../themes";
import { ThemeRemixModal } from "../ThemeRemixModal";

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
    expect(screen.getByRole("button", { name: "Edit dark variant" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit light variant" }));
    expect(screen.getByRole("button", { name: "Edit light variant" })).toBeInTheDocument();
  });
});

