import { describe, expect, it } from "vitest";
import type { RunConfig } from "@/platform/ipc";
import { playwrightOwns, testBasesFor } from "../context";
import { detectRunTargets, targetConfig } from "../targets";

const config = (id: string, kind: string, command: string, args: string[], extra: Partial<RunConfig> = {}): RunConfig => ({
  id,
  name: id,
  kind,
  command,
  args,
  cwd: null,
  env: {},
  detected: true,
  isTest: true,
  debugAdapter: "js-debug",
  ...extra,
});

// What detection gives a Playwright package whose `test*` scripts each run a slice of the suite.
const CONFIGS: RunConfig[] = [
  config("playwright", "playwright", "npx", ["playwright", "test"], {
    params: { testDir: "tests/script-management" },
  }),
  ...["test", "test:api", "test:func", "test:prod", "test:regression", "test:staging"].map((name) =>
    config(`npm:${name}`, "npm", "npm", ["run", name]),
  ),
];

const SPEC = "tests/script-management/prod/work-order/prod-checklist-work-order.spec.ts";
const CONTENT = `import { test, expect } from '@fixture-manager';

test.describe('Work Order - Production Checklist', () => {
  test('TC-WO-01 - Search: keyword search returns matching records without timeout', { tag: ['@prod'] }, async () => {
    expect(1).toBe(1);
  });
});
`;

describe("Playwright specs", () => {
  it("run on Playwright alone instead of offering every test script", () => {
    expect(testBasesFor(SPEC, CONFIGS).map((c) => c.id)).toEqual(["playwright"]);
  });

  it("run one test by its line, without Jest's -t", () => {
    const targets = detectRunTargets(CONTENT, SPEC);
    const test = targets.find((t) => t.kind === "test");
    // `test.describe` is Playwright's suite: it gets its own icon and names the test.
    expect(targets.map((t) => [t.kind, t.line])).toEqual([
      ["suite", 2],
      ["test", 3],
    ]);
    expect(test?.path[0]).toBe("Work Order - Production Checklist");
    const run = targetConfig(test!, SPEC, CONFIGS, CONTENT);
    expect(run?.command).toBe("npx");
    expect(run?.args).toEqual(["playwright", "test", `${SPEC}:4`]);

    const suite = targets.find((t) => t.kind === "suite");
    expect(targetConfig(suite!, SPEC, CONFIGS, CONTENT)?.args).toEqual(["playwright", "test", `${SPEC}:3`]);
  });

  it("are the files under testDir; other tests keep the package scripts", () => {
    const unit = "src/utils/date.test.ts";
    expect(playwrightOwns(CONFIGS[0]!, SPEC)).toBe(true);
    expect(playwrightOwns(CONFIGS[0]!, unit)).toBe(false);
    expect(testBasesFor(unit, CONFIGS).map((c) => c.id)).toEqual(CONFIGS.slice(1).map((c) => c.id));
  });

  it("of a package in a subfolder run from it, relative to it", () => {
    const web = config("playwright:web", "playwright", "pnpm", ["exec", "playwright", "test"], {
      cwd: "web",
      module: "web",
    });
    expect(playwrightOwns(web, "web/e2e/login.spec.ts")).toBe(true);
    expect(playwrightOwns(web, "api/login.spec.ts")).toBe(false);
    const file = testBasesFor("web/e2e/login.spec.ts", [web]);
    expect(file.map((c) => c.id)).toEqual(["playwright:web"]);
    const [target] = detectRunTargets("test('logs in', async () => {});\n", "web/e2e/login.spec.ts");
    expect(targetConfig(target!, "web/e2e/login.spec.ts", [web])?.args).toEqual([
      "exec",
      "playwright",
      "test",
      "e2e/login.spec.ts:1",
    ]);
  });
});
