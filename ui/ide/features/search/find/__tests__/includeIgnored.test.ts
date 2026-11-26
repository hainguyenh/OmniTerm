import { describe, expect, it } from "vitest";

import { buildQuery, describeQuery, useFindPopup, type FindOptions } from "../store";

const options = (over: Partial<FindOptions> = {}): FindOptions => ({
  ...useFindPopup.getState(),
  pattern: "needle",
  ...over,
});

describe("Find in Files: Include Ignored Files", () => {
  it("is off by default, so a project search skips the folders .gitignore excludes", () => {
    expect(useFindPopup.getState().includeIgnored).toBe(false);
    const q = buildQuery(options(), { kind: "project" }, 100);
    expect(q.includeIgnored).toBeUndefined();
    expect(describeQuery(q, null)).toBe("'needle' in Project");
  });

  it("asks the backend to walk ignored folders too, and says so in the Find tab title", () => {
    const q = buildQuery(options({ includeIgnored: true }), { kind: "project" }, 100);
    expect(q.includeIgnored).toBe(true);
    expect(describeQuery(q, null)).toBe("'needle' in Project, including ignored files");
  });
});
