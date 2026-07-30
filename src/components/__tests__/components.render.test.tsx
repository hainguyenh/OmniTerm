/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mockOmnitermAPI } from "../../testUtils";
import { TOKYO_NIGHT } from "../../themes";

import ConfirmDialog from "../ConfirmDialog";
import InfoDialog from "../InfoDialog";
import ConnectionForm from "../ConnectionForm";
import FileBrowser from "../FileBrowser";
import OverlayBar from "../OverlayBar";
import RDPView from "../RDPView";
import SessionMetricsChips from "../SessionMetricsChips";
import { ThemeRemixModal } from "../ThemeRemixModal";
import { TitleBar } from "../TitleBar";

const sampleConnection = {
  id: "c1",
  name: "Server",
  type: "SSH" as const,
  host: "10.0.0.1",
  port: "22",
  user: "root",
  hasPassword: true,
};

describe("component rendering smoke tests", () => {
  beforeEach(() => {
    mockOmnitermAPI();
    localStorage.clear();
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    } as unknown as typeof ResizeObserver;
  });

  it("renders ConfirmDialog", () => {
    render(<ConfirmDialog title="Discard?" message="You have unsaved changes." onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Discard?")).toBeInTheDocument();
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("renders InfoDialog", () => {
    render(<InfoDialog title="Done" message="Operation completed." tone="success" onClose={vi.fn()} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Operation completed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });

  it("renders ConnectionForm in create mode", () => {
    render(<ConnectionForm folders={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByPlaceholderText("My Server")).toBeInTheDocument();
    expect(screen.getByText("SSH")).toBeInTheDocument();
    expect(screen.getByText("RDP")).toBeInTheDocument();
    // Port defaults to 22 but lives in Advanced, which starts collapsed on a new connection.
    expect(screen.queryByDisplayValue("22")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    expect(screen.getByDisplayValue("22")).toBeInTheDocument();
  });

  it("names the Parent Folder root after the workspace", () => {
    render(
      <ConnectionForm
        folders={[{ id: "scripts", name: "scripts" }]}
        rootLabel="MyProject"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    expect(screen.getByRole("option", { name: "MyProject" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Root" })).not.toBeInTheDocument();
  });

  /** An <option> collapses leading whitespace, so a nested folder has to spell out its own path. */
  it("labels each Parent Folder option with its full path", () => {
    render(
      <ConnectionForm
        folders={[
          { id: "f1", name: "infra" },
          { id: "f2", name: "deploy", parentId: "f1" },
          { id: "f3", name: "prod", parentId: "f2" },
        ]}
        rootLabel="MyProject"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    expect(screen.getByRole("option", { name: "infra" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "infra / deploy" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "infra / deploy / prod" })).toBeInTheDocument();
  });

  it("renders FileBrowser header", async () => {
    render(<FileBrowser id="c1" connectionName="Server" active />);
    await waitFor(() => expect(screen.getByText(/Server/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /home/i })).toBeInTheDocument();
  });

  it("renders OverlayBar", async () => {
    render(<OverlayBar />);
    await waitFor(() => expect(screen.getByText("Remote session")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /restore/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
  });

  it("renders RDPView placeholder", () => {
    const { container } = render(<RDPView id="r1" connection={sampleConnection} active={false} overlayActive={false} />);
    expect(container.querySelector(".h-full.w-full")).toBeInTheDocument();
  });

  it("renders SessionMetricsChips", () => {
    render(
      <SessionMetricsChips
        status="connected"
        latency={42}
        metrics={{
          latency: 42,
          cpu: 10,
          memUsed: 2 * 1024 * 1024 * 1024,
          memTotal: 4 * 1024 * 1024 * 1024,
          diskUsedPct: 55,
          ts: Date.now(),
        }}
        connectedAt={Date.now() - 60000}
      />,
    );
    expect(screen.getByText("42 ms")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
  });

  it("renders ThemeRemixModal when open", async () => {
    render(
      <ThemeRemixModal
        isOpen
        onClose={vi.fn()}
        themes={[TOKYO_NIGHT]}
        setThemes={vi.fn()}
        appSettings={{
          themeId: "tokyo-night",
          fontSize: 14,
          smartColors: true,
          checkUpdatesOnStartup: true,
          darkMode: true,
        }}
        setAppSettings={vi.fn()}
        currentTheme={TOKYO_NIGHT}
      />,
    );
    await waitFor(() => expect(screen.getByText("Theme Remix")).toBeInTheDocument());
  });

  it("renders TitleBar", async () => {
    render(
      <TitleBar
        appSettings={{
          themeId: "tokyo-night",
          fontSize: 14,
          smartColors: true,
          checkUpdatesOnStartup: true,
          darkMode: true,
        }}
        setAppSettings={vi.fn()}
        themes={[]}
        onSettingsOpen={vi.fn()}
        setThemeRemixOpen={vi.fn()}
        updateState={null}
      />,
    );
    await waitFor(() => expect(screen.getByText("OmniTerm")).toBeInTheDocument());
  });
});
