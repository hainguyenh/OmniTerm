/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { registerTitleItem } from "../contributions";
import { TitleBar } from "../TitleBar";

describe("TitleBar centered items", () => {
  const disposers: Array<() => void> = [];
  afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

  it("puts a centered item in the middle group, not with the right-aligned items", () => {
    const Mark = (id: string) => () => <span data-testid={id} />;
    disposers.push(
      registerTitleItem({ id: "t.run", align: "right", priority: 0, center: true, component: Mark("run") }),
      registerTitleItem({ id: "t.other", align: "right", priority: 1, component: Mark("other") }),
    );
    const { container } = render(<TitleBar />);
    const center = container.querySelector("[data-titlebar-center]");
    expect(center?.querySelector('[data-title-item="t.run"]')).not.toBeNull();
    expect(center?.querySelector('[data-title-item="t.other"]')).toBeNull();
    expect(container.querySelector('[data-title-item="t.other"]')).not.toBeNull();
  });
});
