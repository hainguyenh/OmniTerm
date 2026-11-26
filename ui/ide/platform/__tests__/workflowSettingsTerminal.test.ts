import { describe, expect, it } from "vitest";

import { TERMINAL_MAX_FPS_OPTIONS, validateTerminal } from "../workflowSettings";

describe("validateTerminal — maxFps", () => {
  it("defaults to an unlimited refresh rate when the setting is missing", () => {
    expect(validateTerminal({}).maxFps).toBe("unlimited");
  });

  it("keeps every rate the settings page offers", () => {
    for (const { value } of TERMINAL_MAX_FPS_OPTIONS) {
      expect(validateTerminal({ maxFps: value }).maxFps).toBe(value);
    }
  });

  it("falls back to unlimited for a stored value it does not know", () => {
    expect(validateTerminal({ maxFps: "144" }).maxFps).toBe("unlimited");
    expect(validateTerminal({ maxFps: 30 }).maxFps).toBe("unlimited");
  });
});
