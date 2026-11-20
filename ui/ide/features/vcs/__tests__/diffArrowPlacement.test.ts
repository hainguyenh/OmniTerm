import { describe, expect, it } from "vitest";

import { centeredArrowTop } from "../diffScroll";

describe("centeredArrowTop", () => {
  it("centres the arrow on a multi-line change instead of its first line", () => {
    expect(centeredArrowTop(100, 180, 600)).toBe(132);
  });

  it("centres on the visible part of a change taller than the view", () => {
    expect(centeredArrowTop(-400, 1000, 600)).toBe(292);
  });

  it("centres on the boundary of an empty change", () => {
    expect(centeredArrowTop(50, 50, 600)).toBe(42);
  });
});
