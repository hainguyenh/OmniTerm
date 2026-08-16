/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { mockOmnitermAPI } from "../../testUtils";
import FileBrowser from "../FileBrowser";

const sampleEntries = [
  { name: "logs", size: 0, mtime: Date.now(), isDir: true, isSymlink: false },
  { name: "readme.txt", size: 1024, mtime: Date.now(), isDir: false, isSymlink: false },
  { name: ".bashrc", size: 200, mtime: Date.now(), isDir: false, isSymlink: false },
];

function renderBrowser(overrides = {}, connectionName = "Server") {
  return render(<FileBrowser id="c1" connectionName={connectionName} active {...overrides} />);
}

describe("FileBrowser", () => {
  beforeEach(() => {
    mockOmnitermAPI({
      sftp: {
        home: async () => "/home/user",
        list: async () => sampleEntries,
      },
    });
    localStorage.clear();
  });

  it("renders connection label and toolbar", async () => {
    renderBrowser();
    await waitFor(() => expect(screen.getByText(/Server/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
  });

  it("lists directories and files", async () => {
    renderBrowser();
    await waitFor(() => expect(screen.getByText("logs")).toBeInTheDocument());
    expect(screen.getByText("readme.txt")).toBeInTheDocument();
  });

  it("hides dotfiles by default and shows them after toggle", async () => {
    renderBrowser();
    await waitFor(() => expect(screen.getByText("readme.txt")).toBeInTheDocument());
    expect(screen.queryByText(".bashrc")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show hidden files' }));
    await waitFor(() => expect(screen.getByText(".bashrc")).toBeInTheDocument());
  });

  it("shows an error strip when listing fails and can be dismissed", async () => {
    mockOmnitermAPI({
      sftp: {
        home: async () => {
          throw new Error("permission denied");
        },
        list: async () => [],
      },
    });
    const { container } = renderBrowser();
    await waitFor(() => expect(screen.getByText("permission denied")).toBeInTheDocument());
    const closeBtn = container.querySelector('[class*="text-theme-error"] button') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(screen.queryByText("permission denied")).not.toBeInTheDocument();
  });

  it("shows transfer progress when onProgress fires", async () => {
    let cb: ((p: { kind: string; name: string; transferred: number; total: number }) => void) | null = null;
    mockOmnitermAPI({
      sftp: {
        home: async () => "/home/user",
        list: async () => sampleEntries,
        onProgress: (_id: string, callback: (p: { kind: string; name: string; transferred: number; total: number }) => void) => {
          cb = callback;
          return () => {};
        },
      },
    });
    renderBrowser();
    await waitFor(() => expect(screen.getByText("readme.txt")).toBeInTheDocument());
    act(() => cb!({ kind: "download", name: "archive.zip", transferred: 50, total: 100 }));
    await waitFor(() => expect(screen.getByText("50%")).toBeInTheDocument());
  });

  it("opens context menu with rename and delete for a file", async () => {
    renderBrowser();
    await waitFor(() => expect(screen.getByText("readme.txt")).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByText("readme.txt"));
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("file context menu for directories hides Download", async () => {
    renderBrowser();
    await waitFor(() => expect(screen.getByText("logs")).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByText("logs"));
    expect(screen.queryByText("Download")).not.toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("shows inline new-folder input when button clicked", async () => {
    renderBrowser();
    await waitFor(() => expect(screen.getByText("logs")).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(screen.getByPlaceholderText("folder name")).toBeInTheDocument();
  });

  it("navigates to a new path typed into the path bar", async () => {
    const listFn = vi.fn(async () => []);
    mockOmnitermAPI({
      sftp: {
        home: async () => "/home/user",
        list: listFn,
      },
    });
    renderBrowser();
    await waitFor(() => expect(listFn).toHaveBeenCalled());
    const input = screen.getByTitle('Remote path — press Enter to navigate');
    fireEvent.change(input, { target: { value: "/etc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(listFn).toHaveBeenCalledWith("c1", "/etc"));
  });
});
