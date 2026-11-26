/** @vitest-environment jsdom */
import { LanguageDescription, LanguageSupport, StreamLanguage, highlightingFor } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { editorsFor, findLanguageDescription, loadSupport, uiModeForPath } = vi.hoisted(() => ({
  editorsFor: vi.fn(),
  findLanguageDescription: vi.fn(),
  loadSupport: vi.fn(),
  uiModeForPath: vi.fn(),
}));

vi.mock("@/editor/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/editor/api")>()),
  editorsFor,
}));
vi.mock("@/editor/core/cm/languages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/editor/core/cm/languages")>()),
  findLanguageDescription,
  loadSupport,
  uiModeForPath,
}));

import { omnitermHighlightStyle } from "@/editor/core/cm/highlight";
import { languageFor, viewerBase } from "../cm";

const support = new LanguageSupport(StreamLanguage.define({ token: (s) => (s.next(), null) }));
const desc = LanguageDescription.of({ name: "Kotlin", support });

describe("diff viewer colours", () => {
  beforeEach(() => {
    editorsFor.mockReset().mockReturnValue([]);
    findLanguageDescription.mockReset().mockReturnValue(desc);
    loadSupport.mockReset().mockResolvedValue(support);
    uiModeForPath.mockReset().mockReturnValue(undefined);
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("paints syntax with the editor's highlight style, not a reduced one", () => {
    const state = EditorState.create({ extensions: viewerBase({ readOnly: true }) });
    for (const tag of [t.keyword, t.string, t.function(t.variableName), t.docComment, t.escape, t.labelName]) {
      expect(highlightingFor(state, [tag])).toBe(omnitermHighlightStyle.style([tag]));
    }
  });

  it("loads the language through the editor's pipeline with the backend's mode", async () => {
    uiModeForPath.mockReturnValue("Kotlin");
    await expect(languageFor("src/Main.kt")).resolves.toBe(support);
    expect(findLanguageDescription).toHaveBeenCalledWith("Kotlin", "src/Main.kt");
    expect(loadSupport).toHaveBeenCalledWith(desc);
  });

  it("follows the mode of an open editor of the file", async () => {
    editorsFor.mockReturnValue([{ ctx: { uiMode: "Angular TypeScript" } }]);
    await languageFor("app/app.component.ts");
    expect(findLanguageDescription).toHaveBeenCalledWith("Angular TypeScript", "app/app.component.ts");
  });

  it("resolves to no language without loading when none matches", async () => {
    findLanguageDescription.mockReturnValue(null);
    await expect(languageFor("notes.unknown")).resolves.toBeNull();
    expect(loadSupport).not.toHaveBeenCalled();
  });

  it("tints only the old lines of a word-compared unified chunk lighter, at full line height", () => {
    new EditorView({ state: EditorState.create({ extensions: viewerBase({ readOnly: true }) }), parent: document.body });
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toMatch(/\.cm-diffWords \.cm-deletedChunk:has\(\+ \.cm-diffLine-fine\)\s*\{[^}]*28%/);
    expect(css).not.toMatch(/\.cm-diffWords \.cm-deletedChunk\s*\{/);
    expect(css).toMatch(/\.cm-deletedChunk \.cm-deletedText\s*\{[^}]*display:\s*inline-block/);
    expect(css).toMatch(/\.cm-merge-b \.cm-changedText\s*\{[^}]*display:\s*inline-block/);
  });
});
