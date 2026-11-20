import { describe, expect, it } from "vitest";
import {
  ecosystemOf,
  interpreterScope,
  overrideValue,
  projectEcosystems,
  projectOverride,
  sdksFor,
  sectionVisible,
} from "../projectEcosystems";

const roots = (...from: Array<string | null>) => from.map((detectedFrom) => ({ detectedFrom }));

describe("project ecosystems", () => {
  it("are read from the build files the roots were detected from", () => {
    expect(ecosystemOf("api/pom.xml")).toBe("jvm");
    expect(ecosystemOf("build.gradle.kts")).toBe("jvm");
    expect(ecosystemOf("web\\package.json")).toBe("node");
    expect(ecosystemOf("requirements-dev.txt")).toBe("python");
    expect(ecosystemOf("App.csproj")).toBe("dotnet");
    expect(ecosystemOf("README.md")).toBeNull();
    expect(projectEcosystems(roots("package.json", "Cargo.toml", "package.json", null))).toEqual(["node", "rust"]);
  });

  it("do not make a project Java unless it has a JVM build", () => {
    expect(projectEcosystems(roots("pyproject.toml"))).toEqual(["python"]);
    expect(projectEcosystems([], null)).toEqual([]);
    expect(projectEcosystems([], { maven: null, gradle: [] })).toEqual([]);
    expect(projectEcosystems(roots("package.json"), { maven: {} })).toEqual(["jvm", "node"]);
    expect(projectEcosystems([], { maven: null, gradle: [{}] })).toEqual(["jvm"]);
  });

  it("offer the SDK of each detected ecosystem only", () => {
    expect(sdksFor(["python", "node"]).map((s) => s.key)).toEqual([
      "languages.python.interpreter",
      "languages.node.interpreter",
    ]);
    expect(sdksFor(["dotnet"])).toEqual([]);
    expect(sdksFor([]).some((s) => s.kind === "jdk")).toBe(false);
  });

  it("list facets and artifacts for JVM projects, configured ones, or the section shown", () => {
    const none = { facets: 0, artifacts: 0 };
    expect(sectionVisible("facets", ["python"], none)).toBe(false);
    expect(sectionVisible("artifacts", ["python"], none)).toBe(false);
    expect(sectionVisible("modules", ["python"], none)).toBe(true);
    expect(sectionVisible("facets", ["jvm"], none)).toBe(true);
    expect(sectionVisible("artifacts", [], { facets: 0, artifacts: 1 })).toBe(true);
    expect(sectionVisible("facets", [], none, "facets")).toBe(true);
  });
});

describe("SDK layers", () => {
  it("treat a project value equal to the saved default as inherited", () => {
    expect(projectOverride("/jdk/21", "/jdk/21")).toBe("");
    expect(projectOverride("/jdk/17", "/jdk/21")).toBe("/jdk/17");
    expect(projectOverride(null, "/jdk/21")).toBe("");
    expect(projectOverride("", "")).toBe("");
  });

  it("remove the project value when the default is chosen", () => {
    expect(overrideValue("", "/jdk/21")).toBeNull();
    expect(overrideValue("/jdk/21", "/jdk/21")).toBeNull();
    expect(overrideValue("/jdk/17", "/jdk/21")).toBe("/jdk/17");
  });

  it("save a virtualenv in the project and any other interpreter as the default", () => {
    const projectRoots = ["D:/work/app", "D:/work/lib"];
    expect(interpreterScope("D:\\work\\app\\.venv\\Scripts\\python.exe", projectRoots)).toBe("project");
    expect(interpreterScope("D:/work/lib/venv/bin/python", projectRoots)).toBe("project");
    expect(interpreterScope("C:/Python313/python.exe", projectRoots)).toBe("global");
    expect(interpreterScope("D:/work/application/.venv/python", projectRoots)).toBe("global");
  });
});
