/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { mockOmnitermAPI } from "../../testUtils";
import ConnectionForm from "../ConnectionForm";

const folders = [
  { id: "f1", name: "Lab" },
  { id: "f2", name: "Nested", parentId: "f1" },
];

const sshConnection = {
  id: "c1",
  name: "Server",
  type: "SSH" as const,
  host: "10.0.0.1",
  port: "22",
  user: "root",
};

/** Port, parent folder, the password-help link and the RDP toggles live behind this. */
const expandAdvanced = () => fireEvent.click(screen.getByRole("button", { name: /advanced/i }));

describe("ConnectionForm", () => {
  beforeEach(() => {
    mockOmnitermAPI();
    localStorage.clear();
    Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "new-id" }, configurable: true, writable: true });
  });

  it("renders create mode with SSH defaults", () => {
    render(<ConnectionForm folders={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText("New Connection")).toBeInTheDocument();
    expect(screen.getByText("SSH")).toBeInTheDocument();
    expandAdvanced();
    expect(screen.getByDisplayValue("22")).toBeInTheDocument();
    expect(screen.queryByText("Share local drives with remote")).not.toBeInTheDocument();
  });

  it("switches to RDP and shows redirect drives", () => {
    render(<ConnectionForm folders={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByText("RDP"));
    expandAdvanced();
    expect(screen.getByDisplayValue("3389")).toBeInTheDocument();
    expect(screen.getByText("Share local drives with remote")).toBeInTheDocument();
  });

  // The shell list is probed from the host now, so it arrives a tick after mount rather than being
  // branched on `platform` in the renderer.
  it("offers macOS shells and saves a local command", async () => {
    mockOmnitermAPI({ app: { platform: "darwin" } });
    const onSave = vi.fn();
    render(<ConnectionForm folders={[]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByText("Local"));
    expect(await screen.findByRole("option", { name: "Default login shell" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Z shell" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "PowerShell" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("./deploy.sh"), { target: { value: "./build.sh" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Connection" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      type: "LOCAL",
      shell: "default",
      localCommand: "./build.sh",
      localKeepOpen: true,
    });
  });

  it("prefills edit mode", () => {
    render(<ConnectionForm folders={folders} initial={sshConnection} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText("Edit Connection")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Server")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10.0.0.1")).toBeInTheDocument();
  });

  /** A saved value hidden behind a collapsed section reads as "not set", which is worse than a click. */
  it("opens Advanced on mount when the saved connection already uses it", () => {
    render(
      <ConnectionForm
        folders={folders}
        initial={{ ...sshConnection, port: "2222", parentId: "f1" }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("2222")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /advanced/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps Advanced closed for a connection with nothing set in it", () => {
    render(<ConnectionForm folders={folders} initial={sshConnection} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /advanced/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByDisplayValue("22")).not.toBeInTheDocument();
  });

  /**
   * Password input belongs to the native Windows prompt, never the webview.
   */
  it("removes credential controls entirely for the Limited provider", () => {
    for (const initial of [undefined, sshConnection]) {
      const { container, unmount } = render(
        <ConnectionForm
          folders={[]}
          initial={initial}
          capabilities={{
            protocols: ['SSH', 'RDP'],
            credentialPolicy: 'prompt-every-time',
            scopes: ['personal', 'workspace'],
            sftp: false,
            importExport: true,
          }}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(screen.queryByText("Credentials")).not.toBeInTheDocument();
      expect(screen.queryByText(/Ask every time/)).not.toBeInTheDocument();
      expandAdvanced();
      expect(screen.getByLabelText("Password help link (optional)")).toBeInTheDocument();
      unmount();
    }
  });

  it("saves the Limited password-help URL as metadata", () => {
    const onSave = vi.fn();
    render(
      <ConnectionForm
        folders={[]}
        capabilities={{
          protocols: ['SSH', 'RDP'],
          credentialPolicy: 'prompt-every-time',
          scopes: ['personal', 'workspace'],
          sftp: false,
          importExport: true,
        }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("My Server"), { target: { value: "Prod" } });
    fireEvent.change(screen.getByPlaceholderText("192.168.1.1"), { target: { value: "10.0.0.8" } });
    expandAdvanced();
    fireEvent.change(screen.getByLabelText("Password help link (optional)"), {
      target: { value: "https://vault.example/prod" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Connection" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      passwordHelpUrl: "https://vault.example/prod",
    });
  });

  it("never renders password persistence controls for the Full provider", () => {
    const { container } = render(
      <ConnectionForm
        folders={[]}
        capabilities={{
          protocols: ['SSH', 'RDP'],
          credentialPolicy: 'prompt-every-time',
          scopes: ['personal', 'workspace'],
          sftp: false,
          importExport: true,
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByText("Save in Windows Credential Manager")).not.toBeInTheDocument();
    expect(screen.queryByText("Credentials")).not.toBeInTheDocument();
  });

  it("saves a new SSH connection with no credential on it", () => {
    const onSave = vi.fn();
    render(<ConnectionForm folders={[]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText("My Server"), { target: { value: "Homelab" } });
    fireEvent.change(screen.getByPlaceholderText("192.168.1.1"), { target: { value: "192.168.1.10" } });
    fireEvent.change(screen.getByPlaceholderText("root"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Connection" }));
    expect(onSave).toHaveBeenCalledOnce();
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ name: "Homelab", type: "SSH", host: "192.168.1.10", port: "22", user: "admin" });
    expect(Object.keys(saved)).not.toContain("password");
    expect(Object.keys(saved)).not.toContain("hasPassword");
  });

  it("closes via Escape when not dirty", () => {
    const onClose = vi.fn();
    render(<ConnectionForm folders={[]} onClose={onClose} onSave={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows discard confirm when closing with dirty changes via Escape", () => {
    const onClose = vi.fn();
    render(<ConnectionForm folders={[]} onClose={onClose} onSave={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("My Server"), { target: { value: "X" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("Discard changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
