import { describe, expect, it, vi } from "vitest";

const notify = vi.hoisted(() => vi.fn());
const executeAction = vi.hoisted(() => vi.fn());

vi.mock("@/workbench/contributions", () => ({ notifications: () => ({ notify }) }));
vi.mock("@/platform/actions", () => ({ executeAction }));

import { upsertServer } from "../servers";

describe("missing language server notice", () => {
  // Regression: with the tools feature loaded after code insight, the notice went up with only
  // "Don't show again" and no way to install the server.
  it("offers to install the server even before the tools feature is loaded", () => {
    upsertServer({ id: 1 as never, name: "vscode-json-language-server", status: "missing" });

    expect(notify).toHaveBeenCalledTimes(1);
    const notice = notify.mock.calls[0]![0] as { key: string; actions: { label: string; run: () => void }[] };
    expect(notice.key).toBe("lsp-missing-vscode-json-language-server");
    expect(notice.actions.map((a) => a.label)).toEqual(["Install", "Language Servers…"]);

    notice.actions[0]!.run();
    expect(executeAction).toHaveBeenCalledWith("tools.install", "vscode-json-language-server");
  });
});
