import { describe, expect, it } from "vitest";
import { isHtmlPath, isWebPath, WEB_PAGE_KIND, webTabInput, webTabPath } from "../browsers";

describe("web page tabs", () => {
  it("gives one tab per file and reads its file back", () => {
    const input = webTabInput("D:/site/index.html");
    expect(input.kind).toBe(WEB_PAGE_KIND);
    expect(webTabInput("D:/site/index.html").key).toBe(input.key);
    expect(webTabInput("D:/site/about.html").key).not.toBe(input.key);
    expect(webTabPath(input)).toBe("D:/site/index.html");
  });

  it("rejects an input of another kind or a damaged restored one", () => {
    expect(webTabPath({ kind: "file", key: "x", data: { path: "D:/a.html" } })).toBeNull();
    expect(webTabPath({ kind: WEB_PAGE_KIND, key: "x", data: { path: 3 } })).toBeNull();
    expect(webTabPath({ kind: WEB_PAGE_KIND, key: "x" })).toBeNull();
  });
});

describe("web paths", () => {
  it("gives HTML files the editor tab and SVG files only the browser", () => {
    expect(isHtmlPath("a/index.HTML")).toBe(true);
    expect(isHtmlPath("a/logo.svg")).toBe(false);
    expect(isWebPath("a/logo.svg")).toBe(true);
  });
});
