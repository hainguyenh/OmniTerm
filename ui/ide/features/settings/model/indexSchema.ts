/**
 * `index.*`: what the project index scans (mirrors `ide-core::settings::IndexSettings`).
 * A change applies when the project is opened again.
 */

export interface IndexValid {
  /** Off: nothing is scanned or persisted; Go to File / Go to Symbol find nothing. */
  enabled: boolean;
  /** Language ids whose symbols are extracted; `"*"` extracts every language's. */
  symbolLanguages: string[];
  /** The first scan waits this long after the project opens. */
  scanDelayMs: number;
}

/** The entry of `symbolLanguages` that extracts every language's symbols. */
export const ALL_SYMBOL_LANGUAGES = "*";

export const DEFAULT_INDEX: IndexValid = {
  enabled: true,
  symbolLanguages: [
    "typescript",
    "typescriptreact",
    "javascript",
    "javascriptreact",
    "rust",
    "csharp",
    "python",
    "json",
    "jsonc",
    "markdown",
  ],
  scanDelayMs: 10_000,
};

export const INDEX_LIMITS = { scanDelayMs: { min: 0, max: 60_000 } } as const;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function validateIndex(raw: unknown): IndexValid {
  const d = DEFAULT_INDEX;
  const i = isObject(raw) ? raw : {};
  const languages = Array.isArray(i.symbolLanguages)
    ? i.symbolLanguages.filter((l): l is string => typeof l === "string" && !!l.trim()).map((l) => l.trim())
    : [...d.symbolLanguages];
  const delay =
    typeof i.scanDelayMs === "number" && Number.isFinite(i.scanDelayMs)
      ? Math.round(Math.min(INDEX_LIMITS.scanDelayMs.max, Math.max(INDEX_LIMITS.scanDelayMs.min, i.scanDelayMs)))
      : d.scanDelayMs;
  return {
    enabled: typeof i.enabled === "boolean" ? i.enabled : d.enabled,
    symbolLanguages: languages,
    scanDelayMs: delay,
  };
}

/** `"rust, python"` → `["rust", "python"]`, without blanks or repeats. */
export function parseLanguageList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,]+/)) {
    const id = part.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
