/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IdleCat } from "../IdleCat";

describe("IdleCat", () => {
  it("renders the light and the dark cat, decorative, for CSS to pick by theme", () => {
    const { container } = render(<IdleCat className="extra" />);
    const cat = container.querySelector("[data-idle-cat]");
    expect(cat?.getAttribute("aria-hidden")).toBe("true");
    expect(cat?.classList.contains("extra")).toBe(true);
    const sources = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "");
    expect(sources).toHaveLength(2);
    expect(sources[0]).toContain("idle-cat-light");
    expect(sources[1]).toContain("idle-cat-dark");
  });

  it("lies on its box only when perched", () => {
    const { container } = render(
      <>
        <IdleCat />
        <IdleCat perched />
      </>,
    );
    const marks = [...container.querySelectorAll("[data-idle-cat]")].map((el) => el.getAttribute("data-idle-cat"));
    expect(marks).toEqual(["", "perched"]);
  });
});
