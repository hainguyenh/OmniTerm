import { describe, expect, it } from "vitest";
import { isPythonProjectMarker, pythonStatusVisible } from "../PythonStatus";

describe("isPythonProjectMarker", () => {
  const roots = ["D:/work/app"];

  it("accepts a build or environment file at the top of the project", () => {
    for (const name of ["pyproject.toml", "setup.py", "requirements.txt", "requirements-dev.txt", "uv.lock", ".python-version"])
      expect(isPythonProjectMarker(`D:/work/app/${name}`, roots)).toBe(true);
  });

  it("ignores a stray script in a TypeScript or Rust project", () => {
    expect(isPythonProjectMarker("D:/work/app/scripts/generate.py", roots)).toBe(false);
    expect(isPythonProjectMarker("D:/work/app/main.py", roots)).toBe(false);
  });

  it("ignores markers deeper down: fixtures, dependencies, tool folders", () => {
    expect(isPythonProjectMarker("D:/work/app/fixtures/python-app/pyproject.toml", roots)).toBe(false);
    expect(isPythonProjectMarker("D:/work/app/node_modules/x/setup.py", roots)).toBe(false);
  });

  it("counts a marker at the top of a linked project, whatever the separators and case", () => {
    expect(isPythonProjectMarker("D:\\Work\\API\\pyproject.toml", ["D:/work/app", "d:/work/api/"])).toBe(true);
  });

  it("does not take a look-alike name for a marker", () => {
    expect(isPythonProjectMarker("D:/work/app/package.json", roots)).toBe(false);
    expect(isPythonProjectMarker("D:/work/app/requirements.md", roots)).toBe(false);
  });
});

describe("pythonStatusVisible", () => {
  it("shows for a Python project", () => {
    expect(pythonStatusVisible({ marked: true, loaded: true }, false)).toBe(true);
  });

  it("shows in another project only while a Python file has the focus", () => {
    expect(pythonStatusVisible({ marked: false, loaded: true }, true)).toBe(true);
    expect(pythonStatusVisible({ marked: false, loaded: true }, false)).toBe(false);
  });

  it("waits for the interpreter to be read", () => {
    expect(pythonStatusVisible({ marked: false, loaded: false }, true)).toBe(false);
  });
});
