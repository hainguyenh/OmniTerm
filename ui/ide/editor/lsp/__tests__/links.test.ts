import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { linkReference } from "../links";

describe("linkReference", () => {
  it("returns the server's file link around the offset", () => {
    const text = Text.of(['<a href="b.html#top">']);
    const range = { start: { line: 0, col: 9 }, end: { line: 0, col: 19 } };
    const link = { range, path: "/p/b.html", fragment: "top", url: null, tooltip: null };
    expect(linkReference(text, [link], 12, "/p/a.html")).toMatchObject({
      kind: "file",
      path: "/p/b.html",
      fragment: "top",
    });
    expect(linkReference(text, [link], 2, "/p/a.html")).toBeNull();
  });

  // On Windows, opening `//server/share` signs in to that server with the user's credentials.
  it("follows no server link to a share the file is not on", () => {
    const text = Text.of(['<a href="file:////evil/share/b.html">']);
    const range = { start: { line: 0, col: 9 }, end: { line: 0, col: 35 } };
    const link = { range, path: "//evil/share/b.html", fragment: null, url: null, tooltip: null };
    expect(linkReference(text, [link], 12, "C:/p/a.html")).toBeNull();
    expect(linkReference(text, [link], 12, "//nas/work/a.html")).toBeNull();
    expect(linkReference(text, [{ ...link, path: "//nas/work/b.html" }], 12, "//NAS/Work/a.html")).toMatchObject({
      kind: "file",
      path: "//nas/work/b.html",
    });
  });
});
