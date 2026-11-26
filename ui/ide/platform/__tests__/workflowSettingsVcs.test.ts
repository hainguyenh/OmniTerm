import { describe, expect, it } from "vitest";

import { validateVcs } from "../workflowSettings";

describe("validateVcs — showDirtyDirectories", () => {
  it("colours the folders of changed files when the setting is missing", () => {
    expect(validateVcs({}).showDirtyDirectories).toBe(true);
    expect(validateVcs(null).showDirtyDirectories).toBe(true);
  });

  it("keeps the folders plain when the user turned it off", () => {
    expect(validateVcs({ showDirtyDirectories: false }).showDirtyDirectories).toBe(false);
  });
});
