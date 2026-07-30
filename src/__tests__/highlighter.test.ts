import { describe, it, expect } from "vitest";
import { OutputHighlighter } from "../highlighter";

describe("OutputHighlighter", () => {
  it("colorizes plain text tokens", () => {
    const h = new OutputHighlighter();
    const out = h.transform(
      "error: /var/log/server.log 192.168.1.1 http://example.com",
      true,
    );
    expect(out).toContain("\x1b[91m");
    expect(out).toContain("\x1b[94m");
    expect(out).toContain("\x1b[96m");
    expect(out).toContain("\x1b[4;96m");
  });

  it("ignores text while alternate screen is active", () => {
    const h = new OutputHighlighter();
    const altOn = h.transform("\x1b[?1049h", true);
    expect(altOn).not.toContain("\x1b[91m");
    const normal = h.transform("error", true);
    expect(normal).not.toContain("\x1b[91m");
    const altOff = h.transform("\x1b[?1049l", true);
    expect(altOff).toContain("\x1b[?1049l");
    expect(h.transform("error", true)).toContain("\x1b[91m");
  });

  it("does not colorize text already colored by the server", () => {
    const h = new OutputHighlighter();
    const colored = h.transform("\x1b[31mconnected\x1b[0m plain", true);
    expect(colored).toContain("\x1b[31m");
    expect(colored).toContain("plain");
  });

  it("carries incomplete escape sequences across chunks", () => {
    const h = new OutputHighlighter();
    const p1 = h.transform("plain \x1b[");
    expect(p1).toBe("plain ");
    const p2 = h.transform("31mred\x1b[0m");
    expect(p2).toContain("[31mred");
  });
});
