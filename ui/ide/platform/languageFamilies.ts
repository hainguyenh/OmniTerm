/**
 * OmniTerm: the language families Settings › Code › Languages switches on and off. A family that
 * is off starts no language server, gets no symbol index and shows none of its settings pages; its
 * files stay plain, highlighted text. `LANGUAGE_FAMILIES` in `crates/ide-core/src/settings.rs`
 * matches this list (name, language ids, default).
 */
export interface LanguageFamily {
  /** Settings key: `languages.families.<name>`. */
  name: string;
  label: string;
  /** What switching it covers, for the page. */
  detail: string;
  /** Language ids of the family (also the ids of its Code Style and Color Scheme pages). */
  languages: readonly string[];
  /** On without a settings entry. */
  enabled: boolean;
  /** Settings pages that belong to it; an entry also covers the pages below it. */
  pages: readonly string[];
}

export const LANGUAGE_FAMILIES: readonly LanguageFamily[] = [
  {
    name: "typescript",
    label: "TypeScript & JavaScript",
    detail: "Node.js, Prettier, oxfmt",
    languages: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
    enabled: true,
    pages: ["languages.typescript", "languages.node", "languages.prettier", "languages.oxfmt"],
  },
  {
    name: "python",
    label: "Python",
    detail: "interpreter, Ruff, debugger",
    languages: ["python"],
    enabled: true,
    pages: ["python.interpreter", "languages.ruff", "build.pythonDebugger"],
  },
  { name: "rust", label: "Rust", detail: "rust-analyzer, Cargo", languages: ["rust"], enabled: true, pages: ["languages.rust"] },
  { name: "dotnet", label: ".NET", detail: "C#, F#", languages: ["csharp", "fsharp"], enabled: true, pages: [] },
  {
    name: "cpp",
    label: "C & C++",
    detail: "clangd, CMake, Arduino",
    languages: ["c", "cpp", "objective-c", "objective-cpp", "cmake", "arduino"],
    enabled: true,
    pages: ["build.cmake"],
  },
  {
    name: "java",
    label: "Java & Kotlin",
    detail: "JDK, Maven, Gradle",
    languages: ["java", "kotlin", "groovy", "scala", "jsp", "properties"],
    enabled: false,
    pages: ["languages.java", "languages.kotlin", "build.gradle", "build.maven"],
  },
  {
    name: "go",
    label: "Go",
    detail: "gopls, modules, build tags",
    languages: ["go", "gomod", "gowork"],
    enabled: false,
    pages: ["languages.go"],
  },
  { name: "php", label: "PHP", detail: "interpreter, PHPStan", languages: ["php"], enabled: false, pages: ["languages.php"] },
  { name: "ruby", label: "Ruby", detail: "interpreter", languages: ["ruby", "erb"], enabled: false, pages: ["languages.ruby"] },
];

/** Every family resolved to on or off: its entry in `raw` (`languages.families`), else its default. */
export function resolveLanguageFamilies(raw: unknown): Record<string, boolean> {
  const entries = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    LANGUAGE_FAMILIES.map((family) => {
      const entry = entries[family.name];
      return [family.name, typeof entry === "boolean" ? entry : family.enabled];
    }),
  );
}

/** The families that are off in the resolved `families`. */
export function disabledFamilies(families: Readonly<Record<string, boolean>>): LanguageFamily[] {
  return LANGUAGE_FAMILIES.filter((family) => families[family.name] === false);
}

/** `languages.families` of raw settings, resolved (`useProject.getState().settings`). */
export function languageFamiliesOf(settings: unknown): Record<string, boolean> {
  const root = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const languages = root.languages && typeof root.languages === "object" ? (root.languages as Record<string, unknown>) : {};
  return resolveLanguageFamilies(languages.families);
}
