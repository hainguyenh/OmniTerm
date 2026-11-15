import { describe, expect, it } from "vitest";

import { enabledSetting, serverEnabled } from "../serverConfig";

describe("serverEnabled", () => {
  it("keeps Go, Java and PHP servers off until enabled", () => {
    for (const name of ["gopls", "jdtls", "kmp-lsp", "intelephense", "phpactor", "laravel-lsp"]) {
      expect(serverEnabled(name, undefined)).toBe(false);
      expect(serverEnabled(name, {})).toBe(false);
      expect(serverEnabled(name, { enabled: true })).toBe(true);
    }
  });

  it("keeps other servers on unless disabled", () => {
    expect(serverEnabled("rust-analyzer", undefined)).toBe(true);
    expect(serverEnabled("rust-analyzer", { enabled: false })).toBe(false);
  });
});

describe("enabledSetting", () => {
  it("removes the key in user settings when the value is the default", () => {
    expect(enabledSetting("rust-analyzer", true, "global")).toBeNull();
    expect(enabledSetting("rust-analyzer", false, "global")).toBe(false);
    expect(enabledSetting("gopls", false, "global")).toBeNull();
    expect(enabledSetting("gopls", true, "global")).toBe(true);
  });

  it("spells the value out in a project", () => {
    expect(enabledSetting("rust-analyzer", true, "project")).toBe(true);
    expect(enabledSetting("gopls", false, "project")).toBe(false);
  });
});
