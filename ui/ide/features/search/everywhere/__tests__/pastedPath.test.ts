import { describe, expect, it, vi } from "vitest";

import { parseLocationQuery } from "../../common/query";
import { pastedPathFile } from "../controller";

const onDisk = (files: string[]) => vi.fn(async (path: string) => (files.includes(path) ? "file" : null));

describe("a path pasted into Search Everywhere", () => {
  // Regression: Shift Shift + a pasted path found nothing for a file the index leaves out
  // (an ignored folder such as `.bizreq/outbox`).
  it("finds a relative path under the project root on disk", async () => {
    const kind = onDisk(["D:/work/app/.bizreq/outbox/56069-decision-task.md"]);
    const hit = await pastedPathFile(".bizreq/outbox/56069-decision-task.md", "D:/work/app/", kind);
    expect(hit).toEqual({
      path: "D:/work/app/.bizreq/outbox/56069-decision-task.md",
      relPath: ".bizreq/outbox/56069-decision-task.md",
      score: 0,
      indices: [],
    });
  });

  it("checks an absolute path as it is and drops a leading ./", async () => {
    const kind = onDisk(["C:/elsewhere/notes.md", "D:/work/app/src/a.ts"]);
    expect((await pastedPathFile("C:/elsewhere/notes.md", "D:/work/app", kind))?.relPath).toBe("C:/elsewhere/notes.md");
    expect((await pastedPathFile("./src/a.ts", "D:/work/app", kind))?.path).toBe("D:/work/app/src/a.ts");
  });

  it("offers nothing for a bare name, a folder, a missing file or a failing lookup", async () => {
    const kind = vi.fn(async (path: string) => (path.endsWith("/src") ? "dir" : null));
    expect(await pastedPathFile("main.ts", "D:/work/app", kind)).toBeNull();
    expect(kind).not.toHaveBeenCalled();
    expect(await pastedPathFile("D:/work/app/src", "D:/work/app", kind)).toBeNull();
    expect(await pastedPathFile("src/gone.ts", "D:/work/app", kind)).toBeNull();
    expect(await pastedPathFile("src/a.ts", null, kind)).toBeNull();
    expect(await pastedPathFile("src/a.ts", "D:/work/app", undefined)).toBeNull();
    const failing = vi.fn(async () => Promise.reject(new Error("denied")));
    expect(await pastedPathFile("src/a.ts", "D:/work/app", failing)).toBeNull();
  });

  it("strips the project root whatever the drive letter's case, and a leading ./", () => {
    expect(parseLocationQuery("d:\\work\\app\\src\\a.ts:12:3", "D:/work/app")).toEqual({ text: "src/a.ts", line: 11, col: 2 });
    expect(parseLocationQuery("./src/a.ts", "D:/work/app").text).toBe("src/a.ts");
    expect(parseLocationQuery('"D:/work/app/README.md"', "D:\\work\\app").text).toBe("README.md");
  });
});
