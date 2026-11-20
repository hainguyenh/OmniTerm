/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { defineBuiltinUiPoints } from "../points";
import { syncUiContributions, uiPoint } from "../projection";

describe("the client's plugin UI points", () => {
  it("know the backend-served run configurations, so a plugin declaring them logs no warning", () => {
    const dispose = defineBuiltinUiPoints();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(uiPoint("runConfigurations")?.title).toBe("Run Configurations");
      syncUiContributions([{ pluginId: "omniterm.test-runner", point: "runConfigurations", decl: {} }] as never, []);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      dispose();
    }
  });
});
