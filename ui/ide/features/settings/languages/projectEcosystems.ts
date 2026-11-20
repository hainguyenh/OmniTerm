/**
 * OmniTerm: which language ecosystems a project uses, read from the build files the backend
 * detected its roots from (`project_roots`) and from its JVM build model. Project Structure
 * shows the SDKs and the Java-only sections (language level, facets, artifacts) only for the
 * ecosystems a project actually has, instead of treating every project as Java.
 */
import type { SdkKind } from "./api";

export type Ecosystem = "jvm" | "python" | "node" | "rust" | "go" | "php" | "dotnet";

/** In the order Project Structure lists them. */
const ORDER: Ecosystem[] = ["jvm", "python", "node", "rust", "go", "php", "dotnet"];

/** Build file names (`crates/ide-workspace/src/roots/detect.rs`) and the ecosystem each marks. */
const BUILD_FILES: Array<[RegExp, Ecosystem]> = [
  [/^pom\.xml$/, "jvm"],
  [/^(build|settings)\.gradle(\.kts)?$/, "jvm"],
  [/^Cargo\.toml$/, "rust"],
  [/^go\.mod$/, "go"],
  [/^(pyproject\.toml|setup\.py|setup\.cfg|Pipfile|requirements[\w.-]*\.txt)$/, "python"],
  [/^package\.json$/, "node"],
  [/^composer\.json$/, "php"],
  [/\.(csproj|fsproj|vbproj|sln|slnx)$/i, "dotnet"],
];

/** The ecosystem a build file (a project-relative path such as `api/pom.xml`) belongs to. */
export function ecosystemOf(buildFile: string): Ecosystem | null {
  const name = buildFile.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return BUILD_FILES.find(([re]) => re.test(name))?.[1] ?? null;
}

/** The ecosystems of a project: its detected roots' build files, plus a Maven or Gradle model. */
export function projectEcosystems(
  detected: ReadonlyArray<{ detectedFrom: string | null }>,
  model?: { maven: unknown; gradle?: readonly unknown[] } | null,
): Ecosystem[] {
  const found = new Set<Ecosystem>();
  for (const root of detected) {
    const eco = root.detectedFrom ? ecosystemOf(root.detectedFrom) : null;
    if (eco) found.add(eco);
  }
  if (model?.maven || model?.gradle?.length) found.add("jvm");
  return ORDER.filter((eco) => found.has(eco));
}

/** The SDK setting of an ecosystem: what Project Structure offers as a default and a project override. */
export interface EcosystemSdk {
  ecosystem: Ecosystem;
  kind: SdkKind;
  label: string;
  /** Settings key (`languages.*`) holding the SDK's path. */
  key: string;
  directory: boolean;
  /** What the empty value means. */
  autoDetail: string;
  browseTitle: string;
}

export const ECOSYSTEM_SDKS: EcosystemSdk[] = [
  {
    ecosystem: "jvm",
    kind: "jdk",
    label: "JDK",
    key: "languages.java.jdk",
    directory: true,
    autoDetail: "per module, the JDK of its Java version",
    browseTitle: "Select JDK Home Directory",
  },
  {
    ecosystem: "python",
    kind: "python",
    label: "Python interpreter",
    key: "languages.python.interpreter",
    directory: false,
    autoDetail: "the project's virtualenv, else python on PATH",
    browseTitle: "Select Python Interpreter",
  },
  {
    ecosystem: "node",
    kind: "node",
    label: "Node interpreter",
    key: "languages.node.interpreter",
    directory: false,
    autoDetail: "node on PATH",
    browseTitle: "Select Node.js Interpreter",
  },
  {
    ecosystem: "rust",
    kind: "rust",
    label: "Rust toolchain",
    key: "languages.rust.toolchain",
    directory: true,
    autoDetail: "rustup default / PATH",
    browseTitle: "Select Toolchain bin Directory",
  },
  {
    ecosystem: "go",
    kind: "go",
    label: "GOROOT",
    key: "languages.go.goroot",
    directory: true,
    autoDetail: "go on PATH",
    browseTitle: "Select GOROOT",
  },
  {
    ecosystem: "php",
    kind: "php",
    label: "PHP interpreter",
    key: "languages.php.interpreter",
    directory: false,
    autoDetail: "php on PATH",
    browseTitle: "Select PHP Interpreter",
  },
];

/** The SDK settings of `ecosystems`, in their order (an ecosystem without one, such as .NET, has none). */
export function sdksFor(ecosystems: readonly Ecosystem[]): EcosystemSdk[] {
  return ecosystems.flatMap((eco) => ECOSYSTEM_SDKS.filter((sdk) => sdk.ecosystem === eco));
}

/**
 * The project layer's own value of an SDK setting: empty when the project uses the default.
 * The project scope reads the effective settings, so a value equal to the saved global one is
 * the inherited default, not an override.
 */
export function projectOverride(projectValue: unknown, savedGlobal: unknown): string {
  return typeof projectValue === "string" && projectValue && projectValue !== savedGlobal ? projectValue : "";
}

/** What to stage in the project layer for a chosen override: `null` (remove it) for the default. */
export function overrideValue(chosen: string, globalValue: unknown): string | null {
  return chosen && chosen !== globalValue ? chosen : null;
}

export type StructureSection =
  | "project"
  | "modules"
  | "dependencies"
  | "libraries"
  | "facets"
  | "artifacts"
  | "sdks";

/**
 * Whether Project Structure lists a section: Facets and Artifacts (JAR / WAR, Web / Spring / JPA)
 * only for a JVM project or once configured; the section being shown always stays listed.
 */
export function sectionVisible(
  section: StructureSection,
  ecosystems: readonly Ecosystem[],
  configured: { facets: number; artifacts: number },
  current?: StructureSection,
): boolean {
  if (section === current || ecosystems.includes("jvm")) return true;
  if (section === "facets") return configured.facets > 0;
  if (section === "artifacts") return configured.artifacts > 0;
  return true;
}

/**
 * The scope a Python interpreter chosen from the status bar is saved in: an interpreter inside
 * the project (its virtualenv) belongs to the project; any other one becomes the default of
 * every project.
 */
export function interpreterScope(interpreter: string, roots: readonly string[]): "project" | "global" {
  const path = interpreter.replaceAll("\\", "/").toLowerCase();
  const inside = roots.some((root) => {
    const r = root.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
    return !!r && path.startsWith(r + "/");
  });
  return inside ? "project" : "global";
}
