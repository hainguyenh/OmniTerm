import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGES, validateLanguages } from "@/platform/languageSettings";
import { DEFAULT_INDEX, parseLanguageList, validateIndex } from "../indexSchema";
import { validateSettings } from "../schema";
import { INDEXING_PAGE } from "../../pages/indexing";
import { optionLabels } from "../../pages/registry";

describe("index settings", () => {
  it("default to the backend's defaults", () => {
    expect(validateIndex(undefined)).toEqual(DEFAULT_INDEX);
    expect(validateSettings({}).index).toEqual(DEFAULT_INDEX);
    expect(DEFAULT_INDEX.enabled).toBe(true);
    expect(DEFAULT_INDEX.scanDelayMs).toBe(3000);
  });

  it("keep valid values and clamp or drop the rest", () => {
    expect(validateIndex({ enabled: false, symbolLanguages: [" rust ", "", 3, "*"], scanDelayMs: 999_999 })).toEqual({
      enabled: false,
      symbolLanguages: ["rust", "*"],
      scanDelayMs: 60_000,
    });
    expect(validateIndex({ enabled: "yes", symbolLanguages: "rust", scanDelayMs: -5 })).toEqual({
      ...DEFAULT_INDEX,
      scanDelayMs: 0,
    });
  });

  it("parse a typed language list without blanks or repeats", () => {
    expect(parseLanguageList(" rust, python  rust,,typescript ")).toEqual(["rust", "python", "typescript"]);
    expect(parseLanguageList("  ")).toEqual([]);
  });

  it("read the language-server idle time and clamp it", () => {
    expect(validateLanguages({}).serverIdleMinutes).toBe(DEFAULT_LANGUAGES.serverIdleMinutes);
    expect(validateLanguages({ serverIdleMinutes: 0 }).serverIdleMinutes).toBe(0);
    expect(validateLanguages({ serverIdleMinutes: 99_999 }).serverIdleMinutes).toBe(1440);
    expect(validateLanguages({ serverIdleMinutes: "5" }).serverIdleMinutes).toBe(10);
  });

  it("are edited on the Indexing page, found by search", () => {
    const keys = (INDEXING_PAGE.sections ?? []).flatMap((s) => s.options.map((o) => ("key" in o ? o.key : o.label)));
    expect(keys).toEqual(["index.enabled", "Extract symbols for", "index.scanDelayMs", "languages.serverIdleMinutes"]);
    expect(optionLabels(INDEXING_PAGE.id)).toContain("Stop an idle language server after");
  });
});
